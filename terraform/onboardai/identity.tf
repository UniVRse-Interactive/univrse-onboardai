# One service account per identity; none is the default compute account.
# Every grant below is on a single resource, except the project-level roles of
# the API runtime (local.api_project_roles). They are the only project-level
# bindings in this module; tests enforce that. Each environment has its own
# accounts, pool and provider (production: onboardai-*, staging:
# onboardai-*-staging), and every grant points at its own environment's
# resources only.

# --- Runtime identities ------------------------------------------------------

# onboardai-web-run, onboardai-api-run, onboardai-tts-run (staging:
# onboardai-<service>-run-staging). web and tts hold no roles. api calls
# Gemini, searches its environment's engine and reads and writes Firestore
# (below). It has no access to the documents bucket: Vertex AI Search serves
# the indexed content.
resource "google_service_account" "runtime" {
  for_each = local.services

  account_id   = each.value.account_id
  display_name = "${local.display_name} ${each.key}: Cloud Run runtime"
  description  = "Runs the ${each.value.name} Cloud Run service."

  depends_on = [google_project_service.required]
}

# The api account authenticates with ADC (no API key).
# production holds, on the project: roles/aiplatform.user (Gemini
# generateContent), roles/discoveryengine.viewer (includes
# discoveryengine.servingConfigs.search) and roles/datastore.user (Firestore).
# staging holds roles/aiplatform.user, and roles/datastore.user limited by an
# IAM condition to its own database; it searches through a grant on its own
# engine (vertex_ai_search.tf). web, tts and the deployer get no project-level
# role.
resource "google_project_iam_member" "api_runtime" {
  for_each = local.api_project_roles

  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.runtime["api"].email}"

  dynamic "condition" {
    for_each = contains(keys(local.api_project_role_conditions), each.key) ? [local.api_project_role_conditions[each.key]] : []

    content {
      title       = condition.value.title
      description = condition.value.description
      expression  = condition.value.expression
    }
  }

  depends_on = [google_project_service.required]
}

# --- Deployer, reached only from GitHub Actions ------------------------------

resource "google_service_account" "deployer" {
  account_id   = "onboardai-deployer${local.name_suffix}"
  display_name = "${local.display_name}: GitHub Actions deployer"
  description  = "Impersonated by the deploy workflow on ${local.github_deploy_branch} through Workload Identity Federation. Pushes images and deploys the three ${local.display_name} services. Has no key."

  depends_on = [google_project_service.required]
}

# One pool per environment, so neither state depends on the other's pool.
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = local.wif_pool_id
  # At most 32 characters.
  display_name = local.is_production ? "OnboardAi GitHub Actions" : "${local.display_name} GitHub"
  description  = "GitHub Actions OIDC for ${var.github_repository}${local.is_production ? "" : ", ${local.github_deploy_branch} branch deploys"}."

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = local.wif_provider_id
  display_name                       = local.is_production ? "GitHub Actions" : "GitHub Actions [${var.environment}]"
  description                        = "Deploy workflow on ${local.github_deploy_branch} of ${var.github_repository} (repository ID ${var.github_repository_id})."

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
# deploy workflow on the environment's branch.
resource "google_service_account_iam_member" "deployer_federation" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository_id/${var.github_repository_id}"
}

# Push images to this environment's repository only.
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
# Cloud Run service in the project (the other environment's included) and
# cannot change IAM policy.
