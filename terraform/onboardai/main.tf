# OnboardAi MVP in the OnBoard AI project: three Cloud Run services (web, api,
# tts), their images, the GitHub Actions deployer, Vertex AI (Gemini and Vertex
# AI Search over the documents bucket), Firestore and Cloud Monitoring alerts.
# The module builds one stack per environment (production, staging) in that
# project, each with its own state in the GCS backend (environment.tf,
# versions.tf).
#
# Prerequisite, done by hand once per project (the google provider needs both to
# enable anything else; the state bucket is created by hand too):
#   gcloud services enable cloudresourcemanager.googleapis.com serviceusage.googleapis.com

# disable_on_destroy = false: removing this module never turns an API off.
# Managing an API that is already on (iam, monitoring, storage are on by
# default in a new project) adopts it. API enablement is project-wide, so only
# production's state manages it; staging uses the APIs production turned on.
resource "google_project_service" "required" {
  for_each = local.is_production ? toset(local.apis) : toset([])

  service            = each.value
  disable_on_destroy = false
}

# The one exception (#30): the Cloud SQL Admin API is enabled by the state of
# the environment that runs employee accounts, which today is staging only,
# because adding it to local.apis would change production's plan. Cloud SQL,
# the Cloud Run Cloud SQL connection and the Cloud SQL Auth Proxy all need it.
# disable_on_destroy = false, so neither state can ever turn it off. When
# production gets accounts, add it to local.apis (production's state) and
# replace this resource with a removed block (lifecycle { destroy = false }),
# which drops it from staging's state without touching the API.
resource "google_project_service" "accounts" {
  for_each = local.employee_accounts ? toset(["sqladmin.googleapis.com"]) : toset([])

  service            = each.value
  disable_on_destroy = false
}

# The project number names the Discovery Engine service agent and the serving
# config; reading it here puts both in the plan instead of "known after apply".
data "google_project" "this" {
  project_id = var.project_id
}
