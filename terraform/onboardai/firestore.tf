# Firestore database in Native mode for the API (contract v2:
# FIRESTORE_DATABASE_ID). Production's is (default); a project has only one, so
# staging's is the named database onboardai-staging. The api account reads and
# writes it with roles/datastore.user (identity.tf); staging's grant carries an
# IAM condition that limits it to onboardai-staging.
#
# Two guards keep the data while var.deletion_protection is true (the default):
# - delete_protection_state: Firestore itself refuses to delete the database,
#   whoever asks (console, gcloud or Terraform).
# - deletion_policy = "ABANDON": `terraform destroy` (or a plan that would
#   replace it) only drops the database from state; the data stays.
# With deletion_protection = false (tear down only, README) both are off and
# destroy deletes the database. Location and type cannot change after creation.
resource "google_firestore_database" "default" {
  name        = local.firestore_database_name
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  delete_protection_state = var.deletion_protection ? "DELETE_PROTECTION_ENABLED" : "DELETE_PROTECTION_DISABLED"
  deletion_policy         = var.deletion_protection ? "ABANDON" : "DELETE"

  # Point-in-time recovery stays off (the default) because it bills 7 days of
  # version storage. Set point_in_time_recovery_enablement once the data
  # stored here must be recoverable.

  depends_on = [google_project_service.required]
}
