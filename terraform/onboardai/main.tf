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

# The Cloud SQL Admin API was enabled by staging's state while only staging ran
# employee accounts (#30). Production runs them too since #45, so the API is in
# local.apis (production's state) like every other API, and this block drops
# it from staging's state without calling Google: the API stays on. A plan in
# the staging workspace shows it as "will no longer be managed by Terraform"
# (forget, not destroy) until that state has been applied once; in production
# it does nothing.
removed {
  from = google_project_service.accounts

  lifecycle {
    destroy = false
  }
}

# The project number names the Discovery Engine service agent and the serving
# config; reading it here puts both in the plan instead of "known after apply".
data "google_project" "this" {
  project_id = var.project_id
}
