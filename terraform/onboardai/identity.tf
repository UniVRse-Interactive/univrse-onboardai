# One service account per identity; none is the default compute account.
# Every grant below is on a single resource, except the three project-level
# roles of the API runtime (local.api_project_roles). They are the only
# project-level bindings in this module; tests enforce that.

# --- Runtime identities ------------------------------------------------------

# onboardai-web-run, onboardai-api-run, onboardai-tts-run. web and tts hold no
# roles. api calls Gemini, searches onboardai-search and reads and writes
# Firestore (below). It has no access to the documents bucket: Vertex AI Search
# serves the indexed content.
resource "google_service_account" "runtime" {
  for_each = local.services

  account_id   = "${each.value.name}-run"
  display_name = "OnboardAi ${each.key}: Cloud Run runtime"
  description  = "Runs the ${each.value.name} Cloud Run service."

  depends_on = [google_project_service.required]
}

# onboardai-api-run authenticates with ADC (no API key) and holds, on the
# project: roles/aiplatform.user (Gemini generateContent),
# roles/discoveryengine.viewer (includes discoveryengine.servingConfigs.search)
# and roles/datastore.user (Firestore). web, tts and the deployer get no
# project-level role.
resource "google_project_iam_member" "api_runtime" {
  for_each = local.api_project_roles

  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.runtime["api"].email}"

  depends_on = [google_project_service.required]
}

# --- Deployer, reached only from GitHub Actions ------------------------------

resource "google_service_account" "deployer" {
  account_id   = "onboardai-deployer"
  display_name = "OnboardAi: GitHub Actions deployer"
  description  = "Impersonated by the deploy workflow on main through Workload Identity Federation. Pushes images and deploys the three OnboardAi services. Has no key."

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "onboardai-github"
  display_name              = "OnboardAi GitHub Actions"
  description               = "GitHub Actions OIDC for ${var.github_repository}."

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions"
  description                        = "Deploy workflow on main of ${var.github_repository} (repository ID ${var.github_repository_id})."

  # Uses ref and repository_id, never the sub claim, so it still holds if the
  # deploy job ever adds a GitHub environment (which changes sub).
  attribute_condition = local.wif_attribute_condition

  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository"          = "assertion.repository"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.ref"                 = "assertion.ref"
  }

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# Any token the provider accepts that comes from this repository ID may
# impersonate the deployer. The provider condition above narrows it to the
# deploy workflow on main.
resource "google_service_account_iam_member" "deployer_federation" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository_id/${var.github_repository_id}"
}

# Push images to the onboardai repository only.
resource "google_artifact_registry_repository_iam_member" "deployer_pushes_images" {
  project    = google_artifact_registry_repository.onboardai.project
  location   = google_artifact_registry_repository.onboardai.location
  repository = google_artifact_registry_repository.onboardai.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}

# Deploy a revision that runs as one of the three runtime accounts, and no other.
resource "google_service_account_iam_member" "deployer_acts_as_runtime" {
  for_each = local.services

  service_account_id = google_service_account.runtime[each.key].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

# Cloud Run Developer on each of the three services only (cloud_run.tf). It can
# update those services but cannot create services, cannot touch any other
# Cloud Run service in the project and cannot change IAM policy.
