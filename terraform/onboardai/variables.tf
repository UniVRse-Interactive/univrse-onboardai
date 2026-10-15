variable "project_id" {
  description = "GCP project ID of the OnBoard AI project, which hosts the whole OnboardAi stack."
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

# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------

variable "alert_emails" {
  description = "Addresses that receive the OnboardAi alerts (monitoring.tf). One Cloud Monitoring email channel each."
  type        = list(string)

  validation {
    condition     = length(var.alert_emails) > 0 && alltrue([for e in var.alert_emails : can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", e))])
    error_message = "alert_emails needs at least one address, and every entry must be an email address."
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
