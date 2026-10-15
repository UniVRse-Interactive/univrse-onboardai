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
  description = "Runtime identity of onboardai-api. Share the Google Drive folder with this address as Viewer."
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
  description = "Run these yourself (needs gh with admin rights on the repository) to set the repository variables the workflows read."
  value = join("\n", concat(
    [for name, value in local.github_variables : "gh variable set ${name} --repo ${var.github_repository} --body '${value}'"],
    var.google_drive_folder_id == "" ? ["# GOOGLE_DRIVE_FOLDER_ID: set google_drive_folder_id and re-run terraform output, or: gh variable set GOOGLE_DRIVE_FOLDER_ID --repo ${var.github_repository} --body '<folder-id>'"] : [],
  ))
}

output "cloud_run_deploy_flags" {
  description = "gcloud run deploy flags per service. .github/workflows/deploy.yml must carry the same strings (checked by terraform test)."
  value       = local.cloud_run_deploy_flags
}
