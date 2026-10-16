# Offline checks of the onboarding checklist agent (#51, F5) and the Gemini
# voice settings of the api (#52, F6): `terraform test` in terraform/onboardai.
# Staging always has the agent's runtime account; production only with
# var.checklist_agent_production. Providers are mocked as in
# tests/accounts.tftest.hcl.

mock_provider "google" {}
mock_provider "google-beta" {}

variables {
  project_id   = "onboardai-test-123"
  alert_emails = ["alerts-a@example.com"]
}

override_module {
  target = module.state_guard
}

override_data {
  target = data.google_project.this
  values = {
    number = "123456789012"
  }
}

# --- Production, default: off ------------------------------------------------------

run "production_has_no_checklist_agent_by_default" {
  command = plan

  assert {
    condition = (
      var.checklist_agent_production == false &&
      length(google_service_account.checklist_agent) == 0 &&
      length(google_project_iam_member.checklist_agent_runtime) == 0 &&
      length(google_service_account_iam_member.deployer_acts_as_checklist_agent) == 0 &&
      length(google_project_iam_member.deployer_deploys_agents) == 0 &&
      output.checklist_agent_service_account_email == null &&
      output.checklist_agent_deploy_settings == null
    )
    error_message = "Production has no checklist agent account, grants or deployer roles until var.checklist_agent_production is true."
  }
}

# --- Production, switched on -------------------------------------------------------

run "production_checklist_agent_when_enabled" {
  command = plan

  variables {
    checklist_agent_production = true
  }

  assert {
    condition = (
      google_service_account.checklist_agent[0].account_id == "onboardai-checklist" &&
      toset(keys(google_project_iam_member.checklist_agent_runtime)) == toset(["roles/aiplatform.user", "roles/datastore.user"]) &&
      length(google_project_iam_member.deployer_deploys_agents) == 1 &&
      length(google_service_account_iam_member.deployer_acts_as_checklist_agent) == 1
    )
    error_message = "With the switch on, production gets onboardai-checklist with roles/aiplatform.user and roles/datastore.user, and the deployer may deploy agents and act as it."
  }

  assert {
    condition = (
      length(google_project_iam_member.checklist_agent_runtime["roles/aiplatform.user"].condition) == 0 &&
      length(google_project_iam_member.checklist_agent_runtime["roles/datastore.user"].condition) == 1 &&
      strcontains(one(google_project_iam_member.checklist_agent_runtime["roles/datastore.user"].condition).expression, "projects/onboardai-test-123/databases/(default)\"") &&
      !strcontains(one(google_project_iam_member.checklist_agent_runtime["roles/datastore.user"].condition).expression, "onboardai-staging") &&
      length(google_service_account.intake_agent) == 0
    )
    error_message = "The checklist agent's Firestore role is limited by an IAM condition to its environment's database, and production still has no intake agent."
  }
}

# --- Staging -----------------------------------------------------------------------

run "staging_checklist_agent_identity_and_grants" {
  command = plan

  variables {
    environment = "staging"
  }

  assert {
    condition = (
      google_service_account.checklist_agent[0].account_id == "onboardai-checklist-staging" &&
      length(google_service_account.checklist_agent[0].account_id) <= 30 &&
      strcontains(google_service_account.checklist_agent[0].display_name, "[staging]") &&
      toset(keys(google_project_iam_member.checklist_agent_runtime)) == toset(["roles/aiplatform.user", "roles/datastore.user"]) &&
      length(google_service_account_iam_member.deployer_acts_as_checklist_agent) == 1 &&
      length(google_project_iam_member.deployer_deploys_agents) == 1
    )
    error_message = "Staging always has onboardai-checklist-staging with roles/aiplatform.user and roles/datastore.user."
  }

  assert {
    condition = (
      length(google_project_iam_member.checklist_agent_runtime["roles/aiplatform.user"].condition) == 0 &&
      strcontains(one(google_project_iam_member.checklist_agent_runtime["roles/datastore.user"].condition).expression, "projects/onboardai-test-123/databases/onboardai-staging\"") &&
      strcontains(one(google_project_iam_member.checklist_agent_runtime["roles/datastore.user"].condition).expression, "projects/123456789012/databases/onboardai-staging\"") &&
      !strcontains(one(google_project_iam_member.checklist_agent_runtime["roles/datastore.user"].condition).expression, "(default)")
    )
    error_message = "Staging's checklist agent reaches the onboardai-staging database only, never (default)."
  }

  assert {
    condition = (
      output.checklist_agent_deploy_settings.location == var.intake_agent_location &&
      output.checklist_agent_deploy_settings.display_name == "OnboardAi onboarding checklist (staging)" &&
      output.checklist_agent_deploy_settings.firestore_database == "onboardai-staging"
    )
    error_message = "The checklist agent deploys to the intake agent's Agent Engine region, as 'OnboardAi onboarding checklist (staging)', against onboardai-staging."
  }

  # The api needs no new grant to query the agent.
  assert {
    condition     = length(google_project_iam_member.api_runtime["roles/aiplatform.user"].condition) == 0
    error_message = "The api keeps unconditioned roles/aiplatform.user: Gemini, the agent query and Gemini TTS all use it."
  }
}

# --- deploy.yml --------------------------------------------------------------------

run "deploy_workflow_matches_the_checklist_agent_and_voice_contract" {
  command = plan

  variables {
    environment = "staging"
  }

  # Same Agent Engine region and the same names Terraform creates.
  assert {
    condition = (
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).env.INTAKE_AGENT_LOCATION == output.checklist_agent_deploy_settings.location &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "--location \"$INTAKE_AGENT_LOCATION\" \\\n            --display-name \"OnboardAi onboarding checklist ($DEPLOY_ENV)\"") &&
      output.checklist_agent_deploy_settings.display_name == replace("OnboardAi onboarding checklist ($DEPLOY_ENV)", "$DEPLOY_ENV", var.environment) &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "--service-account \"onboardai-checklist$NAME_SUFFIX@$GCP_PROJECT_ID.iam.gserviceaccount.com\"") &&
      google_service_account.checklist_agent[0].account_id == replace("onboardai-checklist$NAME_SUFFIX", "$NAME_SUFFIX", "-staging") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "--firestore-database \"$FIRESTORE_DATABASE_ID\"") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "npm run --silent checklist-agent:deploy -- \\\n")
    )
    error_message = "The checklist agent deploy flags in deploy.yml must name the region, display name, service account and database Terraform prepared."
  }

  # The job: after images, decides first, gates every later step, skips with a
  # notice without the script or (outside staging) without the switch.
  assert {
    condition = (
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.checklist_agent.needs == "images" &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.checklist_agent.outputs == {
        deployed = "$${{ steps.decide.outputs.deploy }}"
        engine   = "$${{ steps.agent.outputs.engine }}"
      } &&
      length(yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.checklist_agent.steps) == 8 &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.checklist_agent.steps[1].id == "decide" &&
      try(yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.checklist_agent.steps[1].if, null) == null &&
      alltrue([for s in slice(yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.checklist_agent.steps, 2, 8) : try(s.if, "") == "steps.decide.outputs.deploy == 'true'"]) &&
      can(regex("(?s)^set -euo pipefail\\nif \\[\\[ \"\\$GITHUB_REF\" != refs/heads/staging && \"\\$CHECKLIST_AGENT_ENABLED\" != true \\]\\]; then\\n  echo \"::notice [^\\n]+\\n  deploy=false\\nelif \\[\\[ -z \"\\$\\(jq -r '\\.scripts\\[\"checklist-agent:deploy\"\\] // \"\" \\| strings' package\\.json\\)\" \\]\\]; then\\n  echo \"::notice [^\\n]+\\n  deploy=false\\nelse\\n  deploy=true\\nfi\\necho \"deploy=\\$deploy\" >> \"\\$GITHUB_OUTPUT\"\\n$", yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.checklist_agent.steps[1].run)) &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.checklist_agent.steps[4].run == "npm ci --omit=dev --ignore-scripts" &&
      startswith(yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.checklist_agent.steps[5].uses, "google-github-actions/auth@") &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.checklist_agent.env.CHECKLIST_AGENT_ENABLED == "$${{ vars.CHECKLIST_AGENT_ENABLED }}"
    )
    error_message = "The checklist_agent job skips with a notice outside staging unless CHECKLIST_AGENT_ENABLED is true, and without a checklist-agent:deploy script; later steps run only when it decided to deploy."
  }

  # The api gets CHECKLIST_AGENT_ENGINE only when that job deployed.
  assert {
    condition = (
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.deploy.env.CHECKLIST_AGENT_DEPLOYED == "$${{ needs.checklist_agent.outputs.deployed }}" &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.deploy.env.CHECKLIST_AGENT_ENGINE == "$${{ needs.checklist_agent.outputs.engine }}" &&
      length(regexall("api_env\\+=\",CHECKLIST_AGENT_ENGINE=", file("${path.module}/../../.github/workflows/deploy.yml"))) == 1 &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "if [[ \"$CHECKLIST_AGENT_DEPLOYED\" == true ]]; then\n")
    )
    error_message = "The api deploy adds CHECKLIST_AGENT_ENGINE only when the checklist_agent job deployed the agent."
  }

  # Voice: defaults when the variable is unset, validated in the config job,
  # GEMINI_TTS_VOICE passed only when set.
  assert {
    condition = alltrue([
      for j in ["config", "deploy"] : (
        yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs[j].env.VOICE_PROVIDER == "$${{ vars.VOICE_PROVIDER || 'gemini' }}" &&
        yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs[j].env.GEMINI_TTS_MODEL == "$${{ vars.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts' }}" &&
        yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs[j].env.GEMINI_TTS_LOCATION == "$${{ vars.GEMINI_TTS_LOCATION || 'global' }}" &&
        yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs[j].env.GEMINI_TTS_VOICE == "$${{ vars.GEMINI_TTS_VOICE }}"
      )
    ])
    error_message = "deploy.yml defaults VOICE_PROVIDER=gemini, GEMINI_TTS_MODEL=gemini-3.8-flash-tts and GEMINI_TTS_LOCATION=global when the GitHub variables are unset, in config and deploy."
  }

  assert {
    condition = (
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "check VOICE_PROVIDER \"$VOICE_PROVIDER\" '^(gemini|kokoro)$'\n") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "check GEMINI_TTS_MODEL \"$GEMINI_TTS_MODEL\" ") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "check GEMINI_TTS_LOCATION \"$GEMINI_TTS_LOCATION\" ") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "check GEMINI_TTS_VOICE \"$GEMINI_TTS_VOICE\" ") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "check CHECKLIST_AGENT_ENABLED \"$CHECKLIST_AGENT_ENABLED\" '^(true|false)$'\n") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "api_env+=\",VOICE_PROVIDER=$VOICE_PROVIDER,GEMINI_TTS_MODEL=$GEMINI_TTS_MODEL,GEMINI_TTS_LOCATION=$GEMINI_TTS_LOCATION\"\n") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "if [[ -n \"$GEMINI_TTS_VOICE\" ]]; then\n            api_env+=\",GEMINI_TTS_VOICE=$GEMINI_TTS_VOICE\"\n          fi\n")
    )
    error_message = "The config job validates the voice variables and CHECKLIST_AGENT_ENABLED; the api gets the three voice settings always and GEMINI_TTS_VOICE only when set."
  }

  # The voice checks accept the defaults.
  assert {
    condition = alltrue([
      can(regex(regex("check VOICE_PROVIDER \"\\$VOICE_PROVIDER\" '([^']+)'", file("${path.module}/../../.github/workflows/deploy.yml"))[0], "gemini")),
      can(regex(regex("check GEMINI_TTS_MODEL \"\\$GEMINI_TTS_MODEL\" '([^']+)'", file("${path.module}/../../.github/workflows/deploy.yml"))[0], "gemini-3.8-flash-tts")),
      can(regex(regex("check GEMINI_TTS_LOCATION \"\\$GEMINI_TTS_LOCATION\" '([^']+)'", file("${path.module}/../../.github/workflows/deploy.yml"))[0], "global")),
      can(regex(regex("check GEMINI_TTS_VOICE \"\\$GEMINI_TTS_VOICE\" '([^']+)'", file("${path.module}/../../.github/workflows/deploy.yml"))[0], "")),
    ])
    error_message = "The defaults (gemini, gemini-3.8-flash-tts, global, no voice) must pass the config job's checks."
  }
}
