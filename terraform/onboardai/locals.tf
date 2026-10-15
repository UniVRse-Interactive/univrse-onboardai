locals {
  # Common labels, merged with a per-component label where a resource accepts labels.
  labels = {
    app        = "onboardai"
    managed-by = "terraform"
  }

  apis = [
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com", # GitHub Actions impersonates the deployer
    "sts.googleapis.com",            # exchanges the GitHub OIDC token
    # Platform service of the architecture; no secret exists yet (the API
    # authenticates to Google APIs with its service account).
    "secretmanager.googleapis.com",
    "aiplatform.googleapis.com",      # the API calls Gemini on Vertex AI
    "discoveryengine.googleapis.com", # Vertex AI Search over the documents
    "firestore.googleapis.com",
    "storage.googleapis.com",    # documents bucket
    "monitoring.googleapis.com", # alert policies and email channels
  ]

  # Project-level roles of onboardai-api-run, the only project-level bindings in
  # this module (tests/onboardai.tftest.hcl enforces it). None of these services
  # offers a narrower predefined grant the API could use.
  api_project_roles = {
    "roles/aiplatform.user"        = "Gemini generateContent on Vertex AI"
    "roles/discoveryengine.viewer" = "Vertex AI Search: discoveryengine.servingConfigs.search"
    "roles/datastore.user"         = "Firestore (default) database: read and write documents"
  }

  # ---------------------------------------------------------------------------
  # Vertex AI Search, Firestore and the documents bucket (contract v2).
  # ---------------------------------------------------------------------------
  search_location      = "global"
  search_collection_id = "default_collection" # the only collection data stores are created in
  data_store_id        = "onboardai-docs"
  search_engine_id     = "onboardai-search"
  docs_bucket_name     = "${var.project_id}-onboardai-docs"

  # Service agent that Discovery Engine reads Cloud Storage imports as.
  discovery_engine_service_agent = "service-${data.google_project.this.number}@gcp-sa-discoveryengine.iam.gserviceaccount.com"

  # Full names use the project number, like the API returns them.
  data_store_name     = "projects/${data.google_project.this.number}/locations/${google_discovery_engine_data_store.docs.location}/collections/${local.search_collection_id}/dataStores/${google_discovery_engine_data_store.docs.data_store_id}"
  serving_config_name = "projects/${data.google_project.this.number}/locations/${google_discovery_engine_search_engine.docs.location}/collections/${google_discovery_engine_search_engine.docs.collection_id}/engines/${google_discovery_engine_search_engine.docs.engine_id}/servingConfigs/default_search"

  # Imports every file in the documents bucket into onboardai-docs. INCREMENTAL
  # adds and updates documents and never deletes; dataSchema content means
  # unstructured files (PDF, DOCX, HTML, TXT and so on) parsed by the layout parser.
  import_request = jsonencode({
    gcsSource = {
      inputUris  = ["gs://${google_storage_bucket.docs.name}/*"]
      dataSchema = "content"
    }
    reconciliationMode = "INCREMENTAL"
  })

  # Service contract v1: Artifact Registry repository and image path.
  repository_id = "onboardai"
  image_prefix  = "${var.region}-docker.pkg.dev/${var.project_id}/${local.repository_id}"

  # ---------------------------------------------------------------------------
  # GitHub Actions identity. Only the deploy workflow on main of this one
  # repository (pinned by numeric ID), started by a push or a manual dispatch,
  # can exchange its OIDC token. Pull requests (refs/pull/...), other branches,
  # other workflows on main (e.g. a future issue_comment or pull_request_target
  # workflow that outsiders can trigger) and forks are refused.
  # ---------------------------------------------------------------------------
  github_deploy_ref          = "refs/heads/main"
  github_deploy_workflow_ref = "${var.github_repository}/.github/workflows/deploy.yml@${local.github_deploy_ref}"

  wif_attribute_condition = join(" && ", [
    "assertion.repository_id == '${var.github_repository_id}'",
    "assertion.repository_owner_id == '${var.github_repository_owner_id}'",
    "assertion.ref == '${local.github_deploy_ref}'",
    "assertion.workflow_ref == '${local.github_deploy_workflow_ref}'",
    "(assertion.event_name == 'push' || assertion.event_name == 'workflow_dispatch')",
  ])

  # ---------------------------------------------------------------------------
  # Cloud Run services (service contract v1). Terraform creates them with a
  # placeholder image; .github/workflows/deploy.yml deploys the real images with
  # exactly these settings (its WEB_/API_/TTS_RUN_FLAGS lines). The test in
  # tests/workflows.tftest.hcl fails if the two disagree, so neither undoes the
  # other on the next apply or deploy.
  # ---------------------------------------------------------------------------
  placeholder_image     = "us-docker.pkg.dev/cloudrun/container/hello"
  container_port        = 8080
  probe_period_seconds  = 5
  probe_timeout_seconds = 3

  services = {
    web = {
      name        = "onboardai-web"
      description = "OnboardAi web: serves the built frontend and avatar, proxies /api/* to onboardai-api."
      cpu         = "1"
      memory      = "512Mi"
      concurrency = 80
      # Cost cap. Static files and a streaming proxy: three instances carry a demo.
      min_instances = 0
      max_instances = 3
      # Above the proxy's 290 s upstream timeout, so the proxy answers 504 itself.
      timeout_seconds           = 300
      cpu_boost                 = false
      health_path               = "/web-health"
      startup_failure_threshold = 12 # 60 s
    }

    api = {
      name        = "onboardai-api"
      description = "OnboardAi API: /api/* routes, Gemini chat and Vertex AI Search retrieval."
      cpu         = "1"
      # The SQLite conversation file (written to the in-memory filesystem) lives
      # in this limit until conversations move to Firestore.
      memory      = "1Gi"
      concurrency = 80
      # Contract: exactly one instance, because conversations are SQLite on local disk.
      min_instances             = 0
      max_instances             = 1
      timeout_seconds           = 300
      cpu_boost                 = true # shortens the cold start before the first chat
      health_path               = "/api/health"
      startup_failure_threshold = 12 # 60 s
    }

    tts = {
      name        = "onboardai-tts"
      description = "OnboardAi TTS: Kokoro voice (model baked into the image)."
      # Measured (README "Cloud Run settings"): one Kokoro q8 render of the longest
      # input peaks near 1 GiB RSS and an 1100 MiB limit was OOM-killed, so 2 GiB.
      # A second vCPU rendered about 17% faster and keeps the event loop free
      # while ONNX Runtime fills a core.
      cpu    = "2"
      memory = "2Gi"
      # Renders run one at a time and the app refuses a 9th queued request with
      # VOICE_BUSY, so never route more than 8 to one instance.
      concurrency               = 8
      min_instances             = 0
      max_instances             = 2 # cost cap
      timeout_seconds           = 300
      cpu_boost                 = true # model load is CPU-bound
      health_path               = "/health"
      startup_failure_threshold = 48 # 240 s for the model to load (503 until then)
    }
  }

  # Flags the deploy workflow must pass to `gcloud run deploy` for each service.
  cloud_run_deploy_flags = {
    for key, s in local.services : key => join(" ", [
      "--cpu=${s.cpu}",
      "--memory=${s.memory}",
      "--concurrency=${s.concurrency}",
      "--min-instances=${s.min_instances}",
      "--max-instances=${s.max_instances}",
      "--timeout=${s.timeout_seconds}",
      "--port=${local.container_port}",
      "--execution-environment=gen2",
      "--ingress=all",
      "--cpu-throttling",
      s.cpu_boost ? "--cpu-boost" : "--no-cpu-boost",
      join(",", [
        "--startup-probe=httpGet.path=${s.health_path}",
        "httpGet.port=${local.container_port}",
        "initialDelaySeconds=0",
        "periodSeconds=${local.probe_period_seconds}",
        "timeoutSeconds=${local.probe_timeout_seconds}",
        "failureThreshold=${s.startup_failure_threshold}",
      ]),
    ])
  }

  # Every repository variable the workflows read (tests/workflows.tftest.hcl
  # checks both directions). Values come from this module.
  github_variables = {
    GCP_PROJECT_ID          = var.project_id
    GCP_REGION              = var.region
    GCP_WIF_PROVIDER        = google_iam_workload_identity_pool_provider.github.name
    GCP_DEPLOYER_SA         = google_service_account.deployer.email
    AI_MODE                 = var.ai_mode
    GEMINI_MODEL            = var.gemini_model
    VERTEX_SEARCH_LOCATION  = google_discovery_engine_search_engine.docs.location
    VERTEX_SEARCH_ENGINE_ID = google_discovery_engine_search_engine.docs.engine_id
    FIRESTORE_DATABASE_ID   = google_firestore_database.default.name
  }
}
