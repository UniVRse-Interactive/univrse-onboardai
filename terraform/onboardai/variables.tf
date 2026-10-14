variable "project_id" {
  description = "GCP project ID that hosts the OnboardAi Cloud Run services."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a GCP project ID (6-30 characters: lowercase letters, digits, hyphens)."
  }
}

variable "region" {
  description = "Region of the Cloud Run services and the Artifact Registry repository (service contract v1: asia-southeast1)."
  type        = string
  default     = "asia-southeast1"
}

# ---------------------------------------------------------------------------
# GitHub repository allowed to deploy (Workload Identity Federation)
# ---------------------------------------------------------------------------

variable "github_repository" {
  description = "owner/name of the repository whose deploy workflow may impersonate the deployer. Also used in the generated gh commands."
  type        = string
  default     = "UniVRse-Interactive/univrse-onboardai"

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must look like owner/name."
  }
}

variable "github_repository_id" {
  description = "Numeric GitHub repository ID. Pinned in the WIF condition because, unlike the name, it cannot be re-registered by someone else after a rename or deletion."
  type        = string
  default     = "1418194026"

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_id))
    error_message = "github_repository_id must be the numeric repository ID (gh api repos/OWNER/NAME --jq .id), not the name."
  }
}

variable "github_repository_owner_id" {
  description = "Numeric GitHub ID of the repository owner (organisation)."
  type        = string
  default     = "281514177"

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_owner_id))
    error_message = "github_repository_owner_id must be numeric (gh api repos/OWNER/NAME --jq .owner.id)."
  }
}

# ---------------------------------------------------------------------------
# App settings. Terraform does not deploy these: they only fill in the
# generated `gh variable set` commands; the deploy workflow reads them from
# the repository variables of the same name.
# ---------------------------------------------------------------------------

variable "ai_mode" {
  description = "AI_MODE of the API service."
  type        = string
  default     = "gemini-chat"

  validation {
    condition     = contains(["demo", "gemini", "gemini-chat", "document-search"], var.ai_mode)
    error_message = "ai_mode must be one of demo, gemini, gemini-chat, document-search."
  }
}

variable "gemini_model" {
  description = "GEMINI_MODEL of the API service."
  type        = string
  default     = "gemini-3.5-flash-lite"

  validation {
    condition     = can(regex("^[A-Za-z0-9._-]+$", var.gemini_model))
    error_message = "gemini_model may only contain letters, digits, dots, underscores and hyphens."
  }
}

variable "google_drive_folder_id" {
  description = "GOOGLE_DRIVE_FOLDER_ID of the API service. Empty leaves its gh command out (the API then answers from the sample tasks)."
  type        = string
  default     = ""

  validation {
    condition     = can(regex("^[A-Za-z0-9_-]*$", var.google_drive_folder_id))
    error_message = "google_drive_folder_id may only contain letters, digits, underscores and hyphens."
  }
}

# ---------------------------------------------------------------------------
# Cost
# ---------------------------------------------------------------------------

variable "images_to_keep" {
  description = "Newest image versions kept per image (web, api, tts) in Artifact Registry. Older ones are deleted after one day. Each kept version is a rollback target."
  type        = number
  default     = 5

  validation {
    condition     = var.images_to_keep >= 1 && var.images_to_keep <= 50 && floor(var.images_to_keep) == var.images_to_keep
    error_message = "images_to_keep must be a whole number from 1 to 50."
  }
}
