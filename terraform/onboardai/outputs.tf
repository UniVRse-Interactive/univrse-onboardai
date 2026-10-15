output "workload_identity_provider" {
  description = "Full resource name of the GitHub OIDC provider (repository variable GCP_WIF_PROVIDER)."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_service_account_email" {
  description = "Service account the deploy workflow impersonates (repository variable GCP_DEPLOYER_SA)."
  value       = google_service_account.deployer.email
}

output "web_runtime_service_account_email" {
  description = "Runtime identity of onboardai-web. Holds no roles."
  value       = google_service_account.runtime["web"].email
}

output "api_runtime_service_account_email" {
  description = "Runtime identity of onboardai-api. Holds roles/aiplatform.user, roles/discoveryengine.viewer and roles/datastore.user on the project."
  value       = google_service_account.runtime["api"].email
}

output "tts_runtime_service_account_email" {
  description = "Runtime identity of onboardai-tts. Holds no roles."
  value       = google_service_account.runtime["tts"].email
}

output "artifact_registry_image_prefix" {
  description = "Image path prefix; images are <prefix>/<web|api|tts>:<git-sha>."
  value       = "${google_artifact_registry_repository.onboardai.location}-docker.pkg.dev/${google_artifact_registry_repository.onboardai.project}/${google_artifact_registry_repository.onboardai.repository_id}"
}

output "service_urls" {
  description = "HTTPS URL of each Cloud Run service."
  value       = { for key, service in google_cloud_run_v2_service.service : service.name => service.uri }
}

output "github_variable_commands" {
  description = "Run these yourself (needs gh with admin rights on the repository) to set every repository variable the workflows read."
  value       = join("\n", [for name, value in local.github_variables : "gh variable set ${name} --repo ${var.github_repository} --body '${value}'"])
}

output "cloud_run_deploy_flags" {
  description = "gcloud run deploy flags per service. .github/workflows/deploy.yml must carry the same strings (checked by terraform test)."
  value       = local.cloud_run_deploy_flags
}

output "docs_bucket_name" {
  description = "Bucket the team uploads documents to (gs://<name>/). Import them with import_documents_command."
  value       = google_storage_bucket.docs.name
}

output "vertex_search_data_store_id" {
  description = "Vertex AI Search data store ID (location global, collection default_collection)."
  value       = google_discovery_engine_data_store.docs.data_store_id
}

output "vertex_search_serving_config" {
  description = "Full serving config name onboardai-api searches (VERTEX_SEARCH_LOCATION and VERTEX_SEARCH_ENGINE_ID point at it)."
  value       = local.serving_config_name
}

output "firestore_database_id" {
  description = "Firestore database of the API (repository variable FIRESTORE_DATABASE_ID)."
  value       = google_firestore_database.default.name
}

output "import_documents_command" {
  description = "Imports every file in the documents bucket into onboardai-docs (incremental: adds and updates, never deletes). Run it after uploading; it returns a long-running operation. Needs gcloud logged in as a user with Discovery Engine Editor or Owner."
  value = join(" \\\n  ", [
    "curl -sS -X POST",
    "-H \"Authorization: Bearer $(gcloud auth print-access-token)\"",
    "-H \"X-Goog-User-Project: ${var.project_id}\"",
    "-H \"Content-Type: application/json\"",
    "\"https://discoveryengine.googleapis.com/v1/${local.data_store_name}/branches/default_branch/documents:import\"",
    "-d '${local.import_request}'",
  ])
}
