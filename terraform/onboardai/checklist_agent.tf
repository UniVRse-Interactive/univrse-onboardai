# Onboarding checklist agent (#51, F5) on Vertex AI Agent Engine. Terraform
# prepares its identity; the deploy workflow creates or updates the reasoning
# engine with the backend's `npm run checklist-agent:deploy` (idempotent by
# display name) and hands its resource name to the api as
# CHECKLIST_AGENT_ENGINE. Only where local.checklist_agent is true: staging
# always, production only once var.checklist_agent_production is set (after
# staging is verified). The deploy workflow skips the agent while the
# repository has no checklist-agent:deploy script, or, in production, while
# the GitHub variable CHECKLIST_AGENT_ENABLED is not true; the api then
# deploys without CHECKLIST_AGENT_ENGINE.
#
#   api --query (its own roles/aiplatform.user)--> agent on Agent Engine
#   agent --Gemini (roles/aiplatform.user)--> Vertex AI, global endpoint
#   agent --Firestore (roles/datastore.user, its database only)--> checklists
#
# The api needs no new grant to query the agent (see intake_agent.tf).

locals {
  # Staging always; production only when the variable says so.
  checklist_agent = !local.is_production || var.checklist_agent_production

  checklist_agent_account_id   = "onboardai-checklist${local.name_suffix}"
  checklist_agent_display_name = "OnboardAi onboarding checklist (${var.environment})"

  # The agent's project-level roles. Firestore is limited by an IAM condition to
  # this environment's database (Firestore evaluates resource.name for
  # database-level conditions; both spellings of the project are accepted).
  checklist_agent_roles = {
    "roles/aiplatform.user" = "Gemini on Vertex AI"
    "roles/datastore.user"  = "Firestore: read and write the onboarding checklist documents"
  }
  checklist_agent_firestore_condition = {
    title       = "${local.firestore_database_name} database only"
    description = "Firestore access for the ${var.environment} checklist agent: the ${local.firestore_database_name} database only."
    expression = join(" || ", [
      for p in distinct([var.project_id, data.google_project.this.number]) :
      "resource.name == \"projects/${p}/databases/${local.firestore_database_name}\""
    ])
  }
}

resource "google_service_account" "checklist_agent" {
  count = local.checklist_agent ? 1 : 0

  account_id   = local.checklist_agent_account_id
  display_name = "${local.display_name} checklist agent: Agent Engine runtime"
  description  = "Runs the reasoning engine \"${local.checklist_agent_display_name}\" (the onboarding checklist agent) on Vertex AI Agent Engine. Calls Gemini and reads and writes Firestore. Has no key."
}

resource "google_project_iam_member" "checklist_agent_runtime" {
  for_each = local.checklist_agent ? local.checklist_agent_roles : {}

  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.checklist_agent[0].email}"

  dynamic "condition" {
    for_each = each.key == "roles/datastore.user" ? [local.checklist_agent_firestore_condition] : []

    content {
      title       = condition.value.title
      description = condition.value.description
      expression  = condition.value.expression
    }
  }
}

# Deploy the agent to run as its own service account.
resource "google_service_account_iam_member" "deployer_acts_as_checklist_agent" {
  count = local.checklist_agent ? 1 : 0

  service_account_id = google_service_account.checklist_agent[0].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}
