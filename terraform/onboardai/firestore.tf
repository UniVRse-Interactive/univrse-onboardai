# Firestore database in Native mode for the API (contract v2:
# FIRESTORE_DATABASE_ID). Production's is (default); a project has only one, so
# staging's is the named database onboardai-staging. The api account reads and
# writes it with roles/datastore.user (identity.tf), whose IAM condition limits
# it to its own environment's database.
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

  # Point-in-time recovery (#56): production holds real account profiles and
  # chats, so it keeps 7 days of versions (reads, exports and clones at any
  # minute of the last 7 days; without it, the last hour only). It bills that
  # version storage (PITR storage, USD 0.1846 per GiB-month in asia-southeast1).
  # Staging keeps the default, off. Switching it is an in-place update.
  point_in_time_recovery_enablement = local.is_production ? "POINT_IN_TIME_RECOVERY_ENABLED" : "POINT_IN_TIME_RECOVERY_DISABLED"

  depends_on = [google_project_service.required]
}

# TTL policy for draft employee imports (#27, #30): Firestore deletes an
# employeeImports document once its purgeAt timestamp has passed (usually
# within a day of it; the API also hides and deletes expired drafts itself).
# Its single-field indexes are off, as Firestore recommends for TTL timestamps:
# the API reads the whole collection and never queries by purgeAt. Only where
# the intake agent runs (staging only): it is what writes the drafts.
resource "google_firestore_field" "employee_imports_ttl" {
  count = local.intake_agent ? 1 : 0

  database   = google_firestore_database.default.name
  collection = "employeeImports"
  field      = "purgeAt"

  ttl_config {}

  index_config {}
}
