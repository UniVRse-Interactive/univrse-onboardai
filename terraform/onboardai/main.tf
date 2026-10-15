# OnboardAi on Cloud Run: three services (web, api, tts), their images, the
# GitHub Actions deployer and the Vertex AI grant of the API. Separate from the FinOps
# digest stack in ../ (own state, own labels); both live in the same project.
#
# Prerequisite (the google provider needs it to enable anything; the FinOps
# stack already turned it on in this project):
#   gcloud services enable cloudresourcemanager.googleapis.com serviceusage.googleapis.com

# disable_on_destroy = false: removing this module never turns an API off. The
# FinOps stack also records run, artifactregistry, iam and secretmanager.
# aiplatform is already on in the project; managing it here adopts it.
resource "google_project_service" "required" {
  for_each = toset(local.apis)

  service            = each.value
  disable_on_destroy = false
}
