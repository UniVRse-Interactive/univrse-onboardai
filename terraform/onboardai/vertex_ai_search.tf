# Vertex AI Search over the company documents (contract v2):
#   documents bucket --(manual import, output import_documents_command)--> data
#   store onboardai-docs --> engine onboardai-search <-- onboardai-api searches
#   projects/<number>/locations/global/collections/default_collection/engines/onboardai-search/servingConfigs/default_search
# The team uploads files to the bucket; importing them is a manual REST call,
# not Terraform. The API reads no file from the bucket and holds no bucket role.

# --- Documents bucket ----------------------------------------------------------

resource "google_storage_bucket" "docs" {
  name          = local.docs_bucket_name
  location      = upper(var.region)
  storage_class = "STANDARD"
  labels        = merge(local.labels, { component = "documents" })

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Destroy fails while the bucket holds documents.
  force_destroy = false

  # Overwritten or deleted documents stay recoverable for 30 days.
  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 30
      with_state                 = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.required]
}

# --- Discovery Engine service agent ---------------------------------------------

# Imports from Cloud Storage run as the Discovery Engine service agent,
# service-<project number>@gcp-sa-discoveryengine.iam.gserviceaccount.com. It
# need not exist yet when the API enable call returns, so a grant that only
# waits for google_project_service can race it and fail with "does not exist".
# google_project_service_identity (google-beta only) calls
# services.generateServiceIdentity, which creates the agent and returns once it
# exists; calling it again is a no-op. The grant below waits for it.
resource "google_project_service_identity" "discovery_engine" {
  provider = google-beta

  project = var.project_id
  service = "discoveryengine.googleapis.com"

  depends_on = [google_project_service.required]
}

# Read access to this bucket only, so imports can read the documents.
# The member is spelled out from the project number (data.google_project) so
# the plan shows the exact principal.
resource "google_storage_bucket_iam_member" "discovery_engine_reads_docs" {
  bucket = google_storage_bucket.docs.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${local.discovery_engine_service_agent}"

  depends_on = [google_project_service_identity.discovery_engine]
}

# --- Data store and engine ---------------------------------------------------

# The provider always creates data stores in collections/default_collection.
#
# document_processing_config cannot be changed after creation (changing it
# means a new data store and a re-import): layout parser for every file type,
# layout-based chunks of at most 500 tokens, each prefixed with its ancestor
# headings so a chunk from the middle of a document keeps its section context.
#
# deletion_policy = "PREVENT": Terraform refuses to destroy or replace the data
# store (README, Tear down). Discovery Engine has no server-side delete
# protection, so this does not stop a delete from the console or the API.
resource "google_discovery_engine_data_store" "docs" {
  location          = local.search_location
  data_store_id     = local.data_store_id
  display_name      = "OnboardAi documents"
  industry_vertical = "GENERIC"
  content_config    = "CONTENT_REQUIRED"
  solution_types    = ["SOLUTION_TYPE_SEARCH"]

  document_processing_config {
    default_parsing_config {
      layout_parsing_config {}
    }

    chunking_config {
      layout_based_chunking_config {
        chunk_size                = 500
        include_ancestor_headings = true
      }
    }
  }

  deletion_policy = "PREVENT"

  depends_on = [google_project_service.required]
}

# Enterprise tier: extractive answers and segments. No LLM add-on is
# requested (search_add_ons unset): the API generates answers with Gemini.
# PREVENT as on the data store: deleting the engine takes search offline.
resource "google_discovery_engine_search_engine" "docs" {
  location          = google_discovery_engine_data_store.docs.location
  collection_id     = local.search_collection_id
  engine_id         = local.search_engine_id
  display_name      = "OnboardAi search"
  industry_vertical = "GENERIC"
  data_store_ids    = [google_discovery_engine_data_store.docs.data_store_id]

  search_engine_config {
    search_tier = "SEARCH_TIER_ENTERPRISE"
  }

  deletion_policy = "PREVENT"
}
