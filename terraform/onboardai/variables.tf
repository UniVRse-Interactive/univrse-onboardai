variable "project_id" {
  description = "GCP project ID of the OnBoard AI project, which hosts the whole OnboardAi stack."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a GCP project ID (6-30 characters: lowercase letters, digits, hyphens)."
  }
}

variable "environment" {
  description = "Stack this plan manages. production: workspace default, state onboardai/default.tfstate, the names it was applied with. staging: workspace staging, state onboardai/staging.tfstate, every resource ID suffixed -staging. A plan fails when this and the selected workspace disagree (environment.tf)."
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production", "staging"], var.environment)
    error_message = "environment must be production or staging."
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
  default     = "UniVRse-Team/univrse-onboardai"

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
  default     = "283518526"

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
# Employee accounts (every environment, #45) and the form intake agent
# (staging only, #30)
# ---------------------------------------------------------------------------

variable "intake_agent_location" {
  description = "Vertex AI Agent Engine region the deploy workflow deploys the employee form intake agent to. deploy.yml carries the same value as INTAKE_AGENT_LOCATION (terraform test checks they match); change both together. Gemini itself is called on the global endpoint."
  type        = string
  default     = "asia-southeast1"

  validation {
    condition     = can(regex("^[a-z]+-[a-z]+[0-9]+$", var.intake_agent_location))
    error_message = "intake_agent_location must be a region such as asia-southeast1."
  }
}

variable "db_password_version" {
  description = "Version of the generated accounts database password. Terraform generates the password during apply without storing it in state, and sends it only when this number changes. Raise it by one to rotate: the database user, the password secret and the DATABASE_URL secret get the new value in the same apply. Redeploy the API afterwards (README, Employee accounts)."
  type        = number
  default     = 1

  validation {
    condition     = var.db_password_version >= 1 && floor(var.db_password_version) == var.db_password_version
    error_message = "db_password_version must be a whole number of at least 1."
  }
}

variable "intake_mcp_token_version" {
  description = "Version of the generated INTAKE_MCP_TOKEN. Generated during apply, never stored in state, sent only when this number changes. Raise it by one to rotate, then redeploy (the API and the agent both read the latest version)."
  type        = number
  default     = 1

  validation {
    condition     = var.intake_mcp_token_version >= 1 && floor(var.intake_mcp_token_version) == var.intake_mcp_token_version
    error_message = "intake_mcp_token_version must be a whole number of at least 1."
  }
}

variable "checklist_agent_production" {
  description = "Creates the onboarding checklist agent's runtime account and grants in production (checklist_agent.tf, #51, #81). Staging always has them. On by default; set false to remove them from production. Also set the GitHub variable CHECKLIST_AGENT_ENABLED=true on production for the deploy workflow to deploy the agent."
  type        = bool
  default     = true
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
# Tear down
# ---------------------------------------------------------------------------

variable "deletion_protection" {
  description = "Keeps Terraform (and, for Firestore and Cloud SQL, anyone) from deleting the Cloud Run services and job, the Vertex AI Search data store and engine, the Firestore database and the accounts Cloud SQL instance and database. Leave it true. To tear a stack down, apply once with false, then destroy (README, Tear down)."
  type        = bool
  default     = true
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
