# Firestore (default) database in Native mode for the API (contract v2:
# FIRESTORE_DATABASE_ID=(default)). onboardai-api-run reads and writes it with
# roles/datastore.user (identity.tf).
#
# Two guards keep the data:
# - delete_protection_state: Firestore itself refuses to delete the database,
#   whoever asks (console, gcloud or Terraform).
# - deletion_policy = "ABANDON": `terraform destroy` (or a plan that would
#   replace it) only drops the database from state; the data stays.
# Location and type cannot change after creation.
resource "google_firestore_database" "default" {
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  deletion_policy         = "ABANDON"

  # Point-in-time recovery stays off (the default) because it bills 7 days of
  # version storage. Set point_in_time_recovery_enablement once the data
  # stored here must be recoverable.

  depends_on = [google_project_service.required]
}
