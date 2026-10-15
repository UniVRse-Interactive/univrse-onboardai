terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.6"
    }
  }

  # State is local (terraform.tfstate in this directory, gitignored) like the
  # FinOps stack. Follow-up: move it to a GCS backend with versioning before more
  # than one person applies this module.
}

provider "google" {
  project = var.project_id
  region  = var.region

  # Needed when authenticating as a user (gcloud) rather than a service account:
  # bills API quota to this project instead of the shared gcloud client project.
  user_project_override = true
  billing_project       = var.project_id
}
