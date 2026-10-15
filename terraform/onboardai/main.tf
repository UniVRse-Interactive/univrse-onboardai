# OnboardAi MVP in the OnBoard AI project: three Cloud Run services (web, api,
# tts), their images, the GitHub Actions deployer, Vertex AI (Gemini and Vertex
# AI Search over the documents bucket), Firestore and Cloud Monitoring alerts.
# This module is the only stack in the project; its state is in the GCS backend
# (versions.tf).
#
# Prerequisite, done by hand once per project (the google provider needs both to
# enable anything else; the state bucket is created by hand too):
#   gcloud services enable cloudresourcemanager.googleapis.com serviceusage.googleapis.com

# disable_on_destroy = false: removing this module never turns an API off.
# Managing an API that is already on (iam, monitoring, storage are on by
# default in a new project) adopts it.
resource "google_project_service" "required" {
  for_each = toset(local.apis)

  service            = each.value
  disable_on_destroy = false
}

# The project number names the Discovery Engine service agent and the serving
# config; reading it here puts both in the plan instead of "known after apply".
data "google_project" "this" {
  project_id = var.project_id
}
