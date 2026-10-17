# Employee form intake agent (#27, #30) on Vertex AI Agent Engine (Agent
# Platform Runtime). Terraform prepares its identity and its secret; the deploy
# workflow creates or updates the reasoning engine itself with the backend's
# `npm run intake-agent:deploy` (idempotent by display name) and hands its
# resource name to the api as INTAKE_AGENT_ENGINE. Only where
# local.intake_agent is true (staging only, environment.tf). The deploy job
# skips the agent while the repository has no intake-agent:deploy script, and
# the api then deploys without INTAKE_AGENT_ENGINE and INTAKE_MCP_TOKEN.
#
#   api --query (its own roles/aiplatform.user)--> agent on Agent Engine
#   agent --Gemini (roles/aiplatform.user)--> Vertex AI, global endpoint
#   agent --Streamable HTTP, Bearer INTAKE_MCP_TOKEN--> <api URL>/mcp
#     (the api is private since #57: the agent also sends its own ID token,
#     audience the api's origin, in X-Serverless-Authorization; run.invoker
#     below)
#
# The api needs no new grant to query the agent: roles/aiplatform.user, which it
# already holds on the project for Gemini (locals.tf), includes
# aiplatform.reasoningEngines.query and the aiplatform.sessions.* permissions
# its client uses to delete each session afterwards.

# --- Agent runtime identity --------------------------------------------------

resource "google_service_account" "intake_agent" {
  count = local.intake_agent ? 1 : 0

  account_id   = local.intake_agent_account_id
  display_name = "${local.display_name} intake agent: Agent Engine runtime"
  description  = "Runs the reasoning engine \"${local.intake_agent_display_name}\" (the employee form intake agent) on Vertex AI Agent Engine. Calls Gemini and reads INTAKE_MCP_TOKEN. Has no key."
}

# Gemini on Vertex AI. Agent Engine's documented role for a custom service
# account; no narrower GA role includes endpoints.predict. Logs written to
# stdout and stderr reach Cloud Logging without a logging role.
resource "google_project_iam_member" "intake_agent_runtime" {
  count = local.intake_agent ? 1 : 0

  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.intake_agent[0].email}"
}

# The api is private (#57, cloud_run.tf): the agent may call it (its /mcp
# endpoint, where INTAKE_MCP_TOKEN still authorises the call) and no other
# service.
resource "google_cloud_run_v2_service_iam_member" "intake_agent_invokes_api" {
  count = local.intake_agent ? 1 : 0

  project  = google_cloud_run_v2_service.service["api"].project
  location = google_cloud_run_v2_service.service["api"].location
  name     = google_cloud_run_v2_service.service["api"].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.intake_agent[0].email}"
}

# --- INTAKE_MCP_TOKEN ----------------------------------------------------------

# Generated during apply and written with a write-only argument: the value is
# in Secret Manager only, never in state, the repository or a log. 48 letters
# and digits (about 285 bits); the API requires at least 32 characters.
ephemeral "random_password" "intake_mcp_token" {
  count = local.intake_agent ? 1 : 0

  length  = 48
  special = false
}

resource "google_secret_manager_secret" "intake_mcp_token" {
  count = local.intake_agent ? 1 : 0

  secret_id = local.secret_ids.intake_mcp_token
  labels    = merge(local.labels, { component = "intake-agent" })

  annotations = {
    description = "INTAKE_MCP_TOKEN: bearer token of the MCP endpoint ${local.services.api.name} serves at /mcp. Read by the api (secret reference) and the intake agent (secret environment variable)."
  }

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "intake_mcp_token" {
  count = local.intake_agent ? 1 : 0

  secret                 = google_secret_manager_secret.intake_mcp_token[0].id
  secret_data_wo         = ephemeral.random_password.intake_mcp_token[0].result
  secret_data_wo_version = var.intake_mcp_token_version

  lifecycle {
    create_before_destroy = true
  }
}

# The api checks the token; the agent sends it. Agent Engine reads a secret
# environment variable as the agent's own service account; the Agent Platform
# service agent needs access only for agents that use agent identity, which
# this one does not.
resource "google_secret_manager_secret_iam_member" "intake_mcp_token" {
  for_each = local.intake_agent ? {
    api   = google_service_account.runtime["api"].email
    agent = google_service_account.intake_agent[0].email
  } : {}

  secret_id = google_secret_manager_secret.intake_mcp_token[0].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${each.value}"
}

# --- Deployer -------------------------------------------------------------------

# Creating and updating a reasoning engine needs aiplatform.reasoningEngines.*
# and Vertex AI's operations on the project: Agent Engine has no
# resource-level grant for creating one, and roles/aiplatform.user is the
# narrowest GA role with reasoningEngines.create and update. This is the only
# project-level role any deployer holds. Staging's deployer has it always;
# production's has it while the checklist agent is on in production (#81,
# var.checklist_agent_production). It is reachable only from the deploy workflow
# (identity.tf).
resource "google_project_iam_member" "deployer_deploys_agents" {
  count = local.intake_agent || local.checklist_agent ? 1 : 0

  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

# Deploy the agent to run as its own service account, and no other new one.
resource "google_service_account_iam_member" "deployer_acts_as_intake_agent" {
  count = local.intake_agent ? 1 : 0

  service_account_id = google_service_account.intake_agent[0].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}
