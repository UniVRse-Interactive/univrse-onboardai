# Container only. The key itself is added out of band (output
# gemini_api_key_add_command) so it never enters Terraform state or this repo.
resource "google_secret_manager_secret" "gemini_api_key" {
  secret_id = "onboardai-gemini-api-key"
  labels    = merge(local.labels, { component = "api" })

  replication {
    auto {}
  }

  # Deleting the container deletes every key version with it.
  deletion_protection = true

  depends_on = [google_project_service.required]
}

# The API runtime is the only identity that can read the key.
resource "google_secret_manager_secret_iam_member" "api_reads_gemini_key" {
  project   = google_secret_manager_secret.gemini_api_key.project
  secret_id = google_secret_manager_secret.gemini_api_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime["api"].email}"
}
