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
    "secretmanager.googleapis.com",
    "aiplatform.googleapis.com", # the API calls Gemini on Vertex AI
    # The API service reads company documents through the Drive API with its own
    # service account; the API must be on in the account's project.
    "drive.googleapis.com",
  ]

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
  # tests/onboardai.tftest.hcl fails if the two disagree, so neither undoes the
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
      description = "OnboardAi API: /api/* routes, Gemini chat and Drive retrieval."
      cpu         = "1"
      # Drive document cache and the SQLite conversation file (written to the
      # in-memory filesystem) live in this limit.
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

  # Repository variables the workflows read. Values come from this module.
  github_variables = merge(
    {
      GCP_PROJECT_ID   = var.project_id
      GCP_REGION       = var.region
      GCP_WIF_PROVIDER = google_iam_workload_identity_pool_provider.github.name
      GCP_DEPLOYER_SA  = google_service_account.deployer.email
      AI_MODE          = var.ai_mode
      GEMINI_MODEL     = var.gemini_model
    },
    var.google_drive_folder_id == "" ? {} : { GOOGLE_DRIVE_FOLDER_ID = var.google_drive_folder_id },
  )
}
