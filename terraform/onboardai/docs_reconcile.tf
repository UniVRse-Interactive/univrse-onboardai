# Document reconciliation (#79). HR's company library lives in three places
# that are written one after another, with no shared transaction: Firestore
# companyDocuments, the documents bucket and the Vertex AI Search data store.
# This Cloud Run job compares the three every hour (scripts/reconcile-company-
# documents.mjs, docs/document-reconciliation.md) and prints the drift as
# structured log lines. In report mode it only reads; in apply mode it repairs
# what it safely can: deletes orphaned index entries and objects and re-imports
# the explicit URI of a file that is missing from the index. It never writes
# Firestore, never imports a whole bucket and never uses a full reconciliation.
#
#   Cloud Scheduler (hourly) --(OAuth token of the trigger account)--> run.googleapis.com ...:run
#   job (image: the api's, command: node) --(ADC of the api runtime account)--> Discovery Engine,
#       Cloud Storage and Firestore of this environment
#
# The job runs as the api runtime account, like db_migrate, and gets no new
# grant: the api's project-level roles/discoveryengine.editor, its
# roles/storage.objectUser on its own bucket and its roles/datastore.user
# (limited to its own database) already cover report mode and apply mode. Their
# narrowing is issue #80. The script's own environment guard refuses a data
# store, bucket or database that belongs to the other environment.

locals {
  docs_reconcile_job_name = "onboardai-docs-reconcile${local.name_suffix}"

  # 30 characters in staging, the account ID limit.
  docs_reconcile_trigger_account_id = "onboardai-docs-trigger${local.name_suffix}"

  # Hourly, at an offset so the two stacks never start together.
  docs_reconcile_schedule = local.is_production ? "7 * * * *" : "37 * * * *"

  # How long the job may go without a successful run before an alert fires.
  docs_reconcile_sla = local.is_production ? "10800s" : "21600s" # 3 h / 6 h

  # report: reads and prints the plan, changes nothing. apply: also repairs.
  # In code, not tfvars: a -var or tfvars switch is not remembered across
  # checkouts. Each flip is a reviewed PR through staging and a one-change plan.
  # Both start in report (#79); apply comes in a later PR.
  docs_reconcile_mode = { production = "report", staging = "report" }[var.environment]
}

resource "google_cloud_run_v2_job" "docs_reconcile" {
  name     = local.docs_reconcile_job_name
  location = var.region
  labels   = merge(local.labels, { component = "documents" })

  deletion_protection = var.deletion_protection

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account       = google_service_account.runtime["api"].email
      execution_environment = "EXECUTION_ENVIRONMENT_GEN2"
      # The script's own deadline is 10 minutes (--timeout-minutes); this is
      # the hard stop above it.
      timeout = "900s"
      # The next hourly run is the retry, and a failure must show as failed.
      max_retries = 0

      containers {
        # Replaced by the deploy workflow (gcloud run jobs update --image) with
        # the api image it just deployed.
        image   = local.placeholder_image
        command = ["node"]
        args    = concat(["scripts/reconcile-company-documents.mjs"], local.docs_reconcile_mode == "apply" ? ["--apply"] : [])

        # Every target is this environment's own, from this module and never
        # from tfvars. No secret and no Cloud SQL connection.
        dynamic "env" {
          for_each = {
            ONBOARDAI_ENVIRONMENT       = var.environment
            GOOGLE_CLOUD_PROJECT        = var.project_id
            FIRESTORE_DATABASE_ID       = local.firestore_database_name
            DOCS_BUCKET                 = google_storage_bucket.docs.name
            VERTEX_SEARCH_DATA_STORE_ID = google_discovery_engine_data_store.docs.data_store_id
            VERTEX_SEARCH_LOCATION      = local.search_location
          }

          content {
            name  = env.key
            value = env.value
          }
        }

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      # Set by every `gcloud run jobs update`.
      client,
      client_version,
      template[0].labels,
      template[0].annotations,
      template[0].template[0].containers[0].image,
    ]
  }

  depends_on = [
    google_project_service.required,
    google_project_iam_member.api_runtime,
  ]
}

# --- Who may start and update the job ---------------------------------------------

# Cloud Scheduler's caller identity. No key, no project role: it can start this
# job and nothing else, and cannot change what the job runs or runs as.
resource "google_service_account" "docs_reconcile_trigger" {
  account_id   = local.docs_reconcile_trigger_account_id
  display_name = "${local.display_name}: document reconciliation trigger"
  description  = "Used by Cloud Scheduler to start ${local.docs_reconcile_job_name}. Holds roles/run.invoker on that job only; has no key."
}

# roles/run.invoker includes run.jobs.run (and run.routes.invoke), which the
# jobs.run call needs. The job's overrides are not used, so nothing more.
resource "google_cloud_run_v2_job_iam_member" "trigger_runs_docs_reconcile" {
  project  = google_cloud_run_v2_job.docs_reconcile.project
  location = google_cloud_run_v2_job.docs_reconcile.location
  name     = google_cloud_run_v2_job.docs_reconcile.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.docs_reconcile_trigger.email}"
}

# The deploy workflow points the job at each new api image (gcloud run jobs
# update --image), on this job only. The deployer already acts as the api
# account (identity.tf), which the job runs as. The workflow never executes it.
resource "google_cloud_run_v2_job_iam_member" "deployer_updates_docs_reconcile" {
  project  = google_cloud_run_v2_job.docs_reconcile.project
  location = google_cloud_run_v2_job.docs_reconcile.location
  name     = google_cloud_run_v2_job.docs_reconcile.name
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

# --- Schedule ---------------------------------------------------------------------

# Cloud Scheduler grants exist at project level only, so the deployer (which
# holds no such role) could not manage this job: Terraform owns it. Scheduler
# mints the OAuth token as the trigger account through its own service agent
# (the Cloud Scheduler service agent role includes iam.serviceAccounts.getAccessToken
# on service accounts of the same project), so the account needs no extra grant.
# Requires cloudscheduler.googleapis.com (local.apis); staging's state does not
# manage APIs, so it must be enabled before staging's apply (README).
resource "google_cloud_scheduler_job" "docs_reconcile" {
  name        = local.docs_reconcile_job_name
  description = "Hourly start of ${local.docs_reconcile_job_name} (${local.docs_reconcile_mode} mode)."
  region      = var.region
  schedule    = local.docs_reconcile_schedule
  time_zone   = "Etc/UTC"

  # jobs.run returns an operation at once.
  attempt_deadline = "60s"

  retry_config {
    retry_count          = 1
    min_backoff_duration = "30s"
  }

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.docs_reconcile.name}:run"

    oauth_token {
      service_account_email = google_service_account.docs_reconcile_trigger.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [
    google_project_service.required,
    google_cloud_run_v2_job_iam_member.trigger_runs_docs_reconcile,
  ]
}
