terraform {
  # 1.11: write-only arguments (secret_data_wo, password_wo), which keep the
  # generated database password and MCP token out of state (accounts.tf,
  # intake_agent.tf).
  required_version = ">= 1.11"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.6"
    }
    # Only for google_project_service_identity (vertex_ai_search.tf), which the
    # GA provider does not have. Kept on the same version as google.
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 8.6"
    }
    # Only for ephemeral "random_password" (3.7+): the database password and
    # the MCP token are generated during apply and never written to state.
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }

  # Remote state in the OnBoard AI project. The bucket (asia-southeast1, uniform
  # access, public access prevention, object versioning) was created by hand and
  # is deliberately not managed here: a module must not own the bucket that holds
  # its own state. Versioning keeps every earlier state for recovery. Backend
  # blocks take no variables, so the bucket name is fixed here.
  backend "gcs" {
    bucket = "project-65a9b676-abdb-4393-bc1-tfstate"
    prefix = "onboardai"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region

  # Needed when authenticating as a user (gcloud) rather than a service account:
  # bills API quota to this project instead of the shared gcloud client project.
  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}
