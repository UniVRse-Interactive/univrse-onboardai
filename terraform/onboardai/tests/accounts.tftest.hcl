# Offline checks of employee accounts and the form intake agent on staging
# (issue #30): `terraform test` in terraform/onboardai. Providers are mocked as
# in tests/staging.tftest.hcl; the random provider is real (it only generates
# values locally). tests/onboardai.tftest.hcl checks that production gets none
# of this.

mock_provider "google" {}
mock_provider "google-beta" {}

variables {
  environment  = "staging"
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

override_resource {
  target = google_service_account.deployer
  values = {
    email = "onboardai-deployer-staging@onboardai-test-123.iam.gserviceaccount.com"
    name  = "projects/onboardai-test-123/serviceAccounts/onboardai-deployer-staging@onboardai-test-123.iam.gserviceaccount.com"
  }
}

override_resource {
  target = google_service_account.runtime["web"]
  values = {
    email = "onboardai-web-run-staging@onboardai-test-123.iam.gserviceaccount.com"
    name  = "projects/onboardai-test-123/serviceAccounts/onboardai-web-run-staging@onboardai-test-123.iam.gserviceaccount.com"
  }
}

override_resource {
  target = google_service_account.runtime["api"]
  values = {
    email = "onboardai-api-run-staging@onboardai-test-123.iam.gserviceaccount.com"
    name  = "projects/onboardai-test-123/serviceAccounts/onboardai-api-run-staging@onboardai-test-123.iam.gserviceaccount.com"
  }
}

override_resource {
  target = google_service_account.runtime["tts"]
  values = {
    email = "onboardai-tts-run-staging@onboardai-test-123.iam.gserviceaccount.com"
    name  = "projects/onboardai-test-123/serviceAccounts/onboardai-tts-run-staging@onboardai-test-123.iam.gserviceaccount.com"
  }
}

override_resource {
  target = google_service_account.intake_agent[0]
  values = {
    email = "onboardai-intake-staging@onboardai-test-123.iam.gserviceaccount.com"
    name  = "projects/onboardai-test-123/serviceAccounts/onboardai-intake-staging@onboardai-test-123.iam.gserviceaccount.com"
  }
}

override_resource {
  target = google_sql_database_instance.accounts[0]
  values = {
    connection_name = "onboardai-test-123:asia-southeast1:onboardai-db-staging"
  }
}

override_resource {
  target = google_secret_manager_secret.intake_mcp_token[0]
  values = {
    id = "projects/onboardai-test-123/secrets/onboardai-intake-mcp-token-staging"
  }
}

override_resource {
  target = google_secret_manager_secret.accounts["database_url"]
  values = {
    id = "projects/onboardai-test-123/secrets/onboardai-database-url-staging"
  }
}

override_resource {
  target = google_secret_manager_secret.accounts["db_password"]
  values = {
    id = "projects/onboardai-test-123/secrets/onboardai-db-password-staging"
  }
}

# --- Cloud SQL -------------------------------------------------------------

run "accounts_instance_is_small_private_and_protected" {
  command = apply

  assert {
    condition = (
      google_sql_database_instance.accounts[0].name == "onboardai-db-staging" &&
      google_sql_database_instance.accounts[0].region == "asia-southeast1" &&
      google_sql_database_instance.accounts[0].database_version == "POSTGRES_17" &&
      google_sql_database_instance.accounts[0].settings[0].edition == "ENTERPRISE" &&
      google_sql_database_instance.accounts[0].settings[0].tier == "db-f1-micro" &&
      google_sql_database_instance.accounts[0].settings[0].availability_type == "ZONAL" &&
      google_sql_database_instance.accounts[0].settings[0].disk_size == 10 &&
      google_sql_database_instance.accounts[0].settings[0].disk_autoresize_limit == 20
    )
    error_message = "Staging accounts: onboardai-db-staging, asia-southeast1, PostgreSQL 17, Enterprise db-f1-micro (Enterprise Plus has no shared core), zonal, 10 GiB growing to 20 GiB at most."
  }

  assert {
    condition = (
      google_sql_database_instance.accounts[0].settings[0].ip_configuration[0].ipv4_enabled == true &&
      length(google_sql_database_instance.accounts[0].settings[0].ip_configuration[0].authorized_networks) == 0 &&
      google_sql_database_instance.accounts[0].settings[0].ip_configuration[0].ssl_mode == "ENCRYPTED_ONLY" &&
      google_sql_database_instance.accounts[0].settings[0].connector_enforcement == "REQUIRED" &&
      alltrue([for f in fileset(path.module, "*.tf") : !strcontains(file("${path.module}/${f}"), "authorized_networks {")])
    )
    error_message = "No public authorized network: only the Cloud Run connection and the Cloud SQL Auth Proxy (connector enforcement), TLS for anything else."
  }

  assert {
    condition = (
      google_sql_database_instance.accounts[0].settings[0].backup_configuration[0].enabled == true &&
      google_sql_database_instance.accounts[0].settings[0].backup_configuration[0].point_in_time_recovery_enabled == false &&
      google_sql_database_instance.accounts[0].settings[0].backup_configuration[0].backup_retention_settings[0].retained_backups == 3 &&
      google_sql_database_instance.accounts[0].settings[0].backup_configuration[0].backup_retention_settings[0].retention_unit == "COUNT"
    )
    error_message = "Minimal backups: daily, three kept, no point-in-time recovery."
  }

  assert {
    condition = (
      google_sql_database_instance.accounts[0].deletion_protection == true &&
      google_sql_database_instance.accounts[0].settings[0].deletion_protection_enabled == true &&
      google_sql_database.accounts[0].deletion_policy == "ABANDON" &&
      google_sql_database.accounts[0].name == "onboardai" &&
      google_sql_database.accounts[0].instance == "onboardai-db-staging"
    )
    error_message = "Deletion protection is on in Terraform and in Cloud SQL, and the onboardai database is only abandoned, never dropped, while protected."
  }

  assert {
    condition = (
      google_sql_database_instance.accounts[0].settings[0].user_labels == tomap({ app = "onboardai", managed-by = "terraform", environment = "staging", component = "accounts" }) &&
      toset(keys(google_project_service.accounts)) == toset(["sqladmin.googleapis.com"])
    )
    error_message = "The instance carries the staging labels, and staging enables the Cloud SQL Admin API."
  }

  # The password is write-only: sent, never stored.
  assert {
    condition = (
      google_sql_user.accounts[0].name == "onboardai" &&
      google_sql_user.accounts[0].instance == "onboardai-db-staging" &&
      tostring(google_sql_user.accounts[0].password_wo_version) == "1" &&
      can(regex("(?m)^\\s+password_wo\\s+= ephemeral\\.random_password\\.db\\[0\\]\\.result$", file("${path.module}/accounts.tf")))
    )
    error_message = "The onboardai user's password comes from password_wo with the ephemeral password (version var.db_password_version), never password."
  }
}

# --- Secrets -----------------------------------------------------------------

run "secrets_hold_no_value_in_state_and_reach_only_their_readers" {
  command = apply

  assert {
    condition = (
      { for k, s in google_secret_manager_secret.accounts : k => s.secret_id } == { db_password = "onboardai-db-password-staging", database_url = "onboardai-database-url-staging" } &&
      google_secret_manager_secret.intake_mcp_token[0].secret_id == "onboardai-intake-mcp-token-staging" &&
      alltrue([
        for s in concat(values(google_secret_manager_secret.accounts), google_secret_manager_secret.intake_mcp_token) :
        length(s.replication[0].user_managed[0].replicas) == 1 && s.replication[0].user_managed[0].replicas[0].location == "asia-southeast1" && s.labels.environment == "staging"
      ])
    )
    error_message = "Three staging secrets, replicated in asia-southeast1 only: onboardai-db-password-staging, onboardai-database-url-staging, onboardai-intake-mcp-token-staging."
  }

  # Write-only values (the mock provider cannot show that a value is absent,
  # so this reads the configuration): three versions, each written with
  # secret_data_wo from an ephemeral password, versioned by its variable.
  assert {
    condition = (
      sum([for f in fileset(path.module, "*.tf") : length(regexall("resource\\s+\"google_secret_manager_secret_version\"", file("${path.module}/${f}")))]) == 3 &&
      sum([for f in fileset(path.module, "*.tf") : length(regexall("(?m)^\\s+secret_data_wo\\s+= ", file("${path.module}/${f}")))]) == 3 &&
      sum([for f in fileset(path.module, "*.tf") : length(regexall("(?m)^\\s+secret_data_wo\\s+= .*ephemeral\\.random_password\\.", file("${path.module}/${f}")))]) == 3 &&
      tostring(google_secret_manager_secret_version.db_password[0].secret_data_wo_version) == "1" &&
      tostring(google_secret_manager_secret_version.database_url[0].secret_data_wo_version) == "1" &&
      tostring(google_secret_manager_secret_version.intake_mcp_token[0].secret_data_wo_version) == "1"
    )
    error_message = "Every secret version is written with secret_data_wo from an ephemeral random_password (never stored in state), versioned by db_password_version or intake_mcp_token_version."
  }

  assert {
    condition = (
      google_secret_manager_secret_version.db_password[0].secret == google_secret_manager_secret.accounts["db_password"].id &&
      google_secret_manager_secret_version.database_url[0].secret == google_secret_manager_secret.accounts["database_url"].id &&
      google_secret_manager_secret_version.intake_mcp_token[0].secret == google_secret_manager_secret.intake_mcp_token[0].id
    )
    error_message = "Each version belongs to its own secret."
  }

  # Readers: the api reads DATABASE_URL and the token, the agent the token, and
  # no service account reads the bare password.
  assert {
    condition = (
      google_secret_manager_secret_iam_member.api_reads_database_url[0].secret_id == google_secret_manager_secret.accounts["database_url"].id &&
      google_secret_manager_secret_iam_member.api_reads_database_url[0].member == "serviceAccount:onboardai-api-run-staging@onboardai-test-123.iam.gserviceaccount.com" &&
      { for k, m in google_secret_manager_secret_iam_member.intake_mcp_token : k => m.member } == {
        api   = "serviceAccount:onboardai-api-run-staging@onboardai-test-123.iam.gserviceaccount.com"
        agent = "serviceAccount:onboardai-intake-staging@onboardai-test-123.iam.gserviceaccount.com"
      } &&
      alltrue([for m in google_secret_manager_secret_iam_member.intake_mcp_token : m.secret_id == google_secret_manager_secret.intake_mcp_token[0].id]) &&
      alltrue([for m in concat(google_secret_manager_secret_iam_member.api_reads_database_url, values(google_secret_manager_secret_iam_member.intake_mcp_token)) : m.role == "roles/secretmanager.secretAccessor"])
    )
    error_message = "Secret Accessor: the api on DATABASE_URL and INTAKE_MCP_TOKEN, the agent on INTAKE_MCP_TOKEN, nobody on the password."
  }

  assert {
    condition = (
      sum([for f in fileset(path.module, "*.tf") : length(regexall("resource\\s+\"google_secret_manager_secret_iam_", file("${path.module}/${f}")))]) == 2 &&
      sum([for f in fileset(path.module, "*.tf") : length(regexall("resource\\s+\"google_secret_manager_secret_iam_member\"", file("${path.module}/${f}")))]) == 2
    )
    error_message = "The only secret grants are api_reads_database_url and intake_mcp_token (members, never a binding or policy)."
  }

  assert {
    condition = (
      output.accounts_secret_ids == {
        db_password      = "onboardai-db-password-staging"
        database_url     = "onboardai-database-url-staging"
        intake_mcp_token = "onboardai-intake-mcp-token-staging"
      } &&
      output.cloud_sql_instance_connection_name == "onboardai-test-123:asia-southeast1:onboardai-db-staging"
    )
    error_message = "The outputs name the secrets and the instance, never a value."
  }
}

# --- Migration job ------------------------------------------------------------

run "migration_job_runs_as_the_api_with_its_database" {
  command = apply

  assert {
    condition = (
      google_cloud_run_v2_job.db_migrate[0].name == "onboardai-db-migrate-staging" &&
      google_cloud_run_v2_job.db_migrate[0].location == "asia-southeast1" &&
      google_cloud_run_v2_job.db_migrate[0].deletion_protection == true &&
      google_cloud_run_v2_job.db_migrate[0].template[0].template[0].service_account == "onboardai-api-run-staging@onboardai-test-123.iam.gserviceaccount.com" &&
      google_cloud_run_v2_job.db_migrate[0].template[0].template[0].max_retries == 1 &&
      output.db_migrate_job_name == "onboardai-db-migrate-staging"
    )
    error_message = "onboardai-db-migrate-staging runs as onboardai-api-run-staging in asia-southeast1, retries once, and is delete-protected."
  }

  assert {
    condition = (
      google_cloud_run_v2_job.db_migrate[0].template[0].template[0].containers[0].command == tolist(["npm"]) &&
      google_cloud_run_v2_job.db_migrate[0].template[0].template[0].containers[0].args == tolist(["run", "db:migrate"]) &&
      length(google_cloud_run_v2_job.db_migrate[0].template[0].template[0].containers[0].env) == 1 &&
      one([for e in google_cloud_run_v2_job.db_migrate[0].template[0].template[0].containers[0].env : e.name]) == "DATABASE_URL" &&
      one([for e in google_cloud_run_v2_job.db_migrate[0].template[0].template[0].containers[0].env : e.value]) == null &&
      one(flatten([for e in google_cloud_run_v2_job.db_migrate[0].template[0].template[0].containers[0].env : [for v in e.value_source : [for r in v.secret_key_ref : "${r.secret}@${r.version}"]]])) == "onboardai-database-url-staging@latest"
    )
    error_message = "The job runs npm run db:migrate with DATABASE_URL as a reference to the latest onboardai-database-url-staging version, and nothing else in its environment."
  }

  assert {
    condition = (
      length(google_cloud_run_v2_job.db_migrate[0].template[0].template[0].volumes) == 1 &&
      toset(flatten([for v in google_cloud_run_v2_job.db_migrate[0].template[0].template[0].volumes : [for c in v.cloud_sql_instance : c.instances]])) == toset(["onboardai-test-123:asia-southeast1:onboardai-db-staging"]) &&
      [for m in google_cloud_run_v2_job.db_migrate[0].template[0].template[0].containers[0].volume_mounts : "${m.name}:${m.mount_path}"] == [for v in google_cloud_run_v2_job.db_migrate[0].template[0].template[0].volumes : "${v.name}:/cloudsql"]
    )
    error_message = "The job reaches the accounts instance through its Cloud SQL connection at /cloudsql, the socket path DATABASE_URL names."
  }

  assert {
    condition = (
      google_cloud_run_v2_job_iam_member.deployer_runs_migrations[0].name == "onboardai-db-migrate-staging" &&
      google_cloud_run_v2_job_iam_member.deployer_runs_migrations[0].role == "roles/run.developer" &&
      google_cloud_run_v2_job_iam_member.deployer_runs_migrations[0].member == "serviceAccount:onboardai-deployer-staging@onboardai-test-123.iam.gserviceaccount.com"
    )
    error_message = "The staging deployer may update and execute the migration job, on that job only."
  }

  # The job's command needs scripts/ in the api image.
  assert {
    condition     = can(regex("(?m)^FROM runtime-base AS api\\n(?:#[^\\n]*\\n)*COPY scripts \\./scripts\\nCMD \\[\"node\", \"server/api-service\\.mjs\"\\]$", file("${path.module}/../../Dockerfile")))
    error_message = "The api stage of the Dockerfile must copy scripts/ (npm run db:migrate runs scripts/migrate-database.mjs) and keep its CMD."
  }
}

# --- Intake agent ----------------------------------------------------------

run "intake_agent_identity_and_grants" {
  command = apply

  assert {
    condition = (
      google_service_account.intake_agent[0].account_id == "onboardai-intake-staging" &&
      length(google_service_account.intake_agent[0].account_id) <= 30 &&
      strcontains(google_service_account.intake_agent[0].display_name, "[staging]") &&
      output.intake_agent_service_account_email == "onboardai-intake-staging@onboardai-test-123.iam.gserviceaccount.com"
    )
    error_message = "The agent runs as its own staging account, onboardai-intake-staging."
  }

  assert {
    condition = (
      google_project_iam_member.intake_agent_runtime[0].role == "roles/aiplatform.user" &&
      google_project_iam_member.intake_agent_runtime[0].member == "serviceAccount:onboardai-intake-staging@onboardai-test-123.iam.gserviceaccount.com" &&
      length(google_project_iam_member.intake_agent_runtime[0].condition) == 0
    )
    error_message = "The agent account holds roles/aiplatform.user (Gemini) on the project, and nothing else there."
  }

  # The api queries the agent with the roles/aiplatform.user it already holds.
  assert {
    condition = (
      contains(keys(google_project_iam_member.api_runtime), "roles/aiplatform.user") &&
      length(google_project_iam_member.api_runtime["roles/aiplatform.user"].condition) == 0
    )
    error_message = "The staging api must keep unconditioned roles/aiplatform.user: it queries the agent and deletes its sessions with it."
  }

  assert {
    condition = output.intake_agent_deploy_settings == {
      location         = "asia-southeast1"
      display_name     = "OnboardAi employee form intake (staging)"
      service_account  = "onboardai-intake-staging@onboardai-test-123.iam.gserviceaccount.com"
      mcp_token_secret = "onboardai-intake-mcp-token-staging"
    }
    error_message = "The deploy settings name the staging agent, its account, its secret and its region."
  }
}

run "employee_imports_expire" {
  command = apply

  assert {
    condition = (
      google_firestore_field.employee_imports_ttl[0].database == "onboardai-staging" &&
      google_firestore_field.employee_imports_ttl[0].collection == "employeeImports" &&
      google_firestore_field.employee_imports_ttl[0].field == "purgeAt" &&
      length(google_firestore_field.employee_imports_ttl[0].ttl_config) == 1 &&
      length(google_firestore_field.employee_imports_ttl[0].index_config) == 1 &&
      length(google_firestore_field.employee_imports_ttl[0].index_config[0].indexes) == 0
    )
    error_message = "A TTL policy on employeeImports.purgeAt in onboardai-staging, with the field's single-field indexes off."
  }
}

run "deletion_protection_can_be_lifted_for_tear_down" {
  command = plan

  variables {
    deletion_protection = false
  }

  assert {
    condition = (
      google_sql_database_instance.accounts[0].deletion_protection == false &&
      google_sql_database_instance.accounts[0].settings[0].deletion_protection_enabled == false &&
      google_sql_database.accounts[0].deletion_policy == "DELETE" &&
      google_cloud_run_v2_job.db_migrate[0].deletion_protection == false
    )
    error_message = "deletion_protection = false lifts the instance, database and job guards for a staging tear down."
  }
}

run "rejects_a_password_version_below_one" {
  command = plan

  variables {
    db_password_version = 0
  }

  expect_failures = [var.db_password_version]
}

run "rejects_a_malformed_agent_location" {
  command = plan

  variables {
    intake_agent_location = "asia southeast"
  }

  expect_failures = [var.intake_agent_location]
}

# --- deploy.yml uses the names Terraform creates ------------------------------

run "deploy_workflow_uses_terraforms_names" {
  command = apply

  assert {
    condition = (
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).env.INTAKE_AGENT_LOCATION == var.intake_agent_location &&
      var.intake_agent_location == "asia-southeast1"
    )
    error_message = "deploy.yml's INTAKE_AGENT_LOCATION must equal var.intake_agent_location."
  }

  # NAME_SUFFIX is -staging on the staging branch (tests/staging.tftest.hcl).
  assert {
    condition = (
      replace("onboardai-db-migrate$NAME_SUFFIX", "$NAME_SUFFIX", "-staging") == google_cloud_run_v2_job.db_migrate[0].name &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "job=\"onboardai-db-migrate$NAME_SUFFIX\"\n") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "--set-cloudsql-instances=\"$GCP_PROJECT_ID:$GCP_REGION:onboardai-db$NAME_SUFFIX\"") &&
      google_sql_database_instance.accounts[0].connection_name == "${var.project_id}:${var.region}:${replace("onboardai-db$NAME_SUFFIX", "$NAME_SUFFIX", "-staging")}" &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "--set-secrets=\"DATABASE_URL=onboardai-database-url$NAME_SUFFIX:latest,INTAKE_MCP_TOKEN=onboardai-intake-mcp-token$NAME_SUFFIX:latest\"") &&
      google_secret_manager_secret.accounts["database_url"].secret_id == replace("onboardai-database-url$NAME_SUFFIX", "$NAME_SUFFIX", "-staging") &&
      google_secret_manager_secret.intake_mcp_token[0].secret_id == replace("onboardai-intake-mcp-token$NAME_SUFFIX", "$NAME_SUFFIX", "-staging")
    )
    error_message = "The migration job, Cloud SQL connection and secret references deploy.yml computes with NAME_SUFFIX must be the ones Terraform creates for staging."
  }

  assert {
    condition = (
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "--display-name \"OnboardAi employee form intake ($DEPLOY_ENV)\"") &&
      output.intake_agent_deploy_settings.display_name == replace("OnboardAi employee form intake ($DEPLOY_ENV)", "$DEPLOY_ENV", var.environment) &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "--service-account \"onboardai-intake$NAME_SUFFIX@$GCP_PROJECT_ID.iam.gserviceaccount.com\"") &&
      google_service_account.intake_agent[0].account_id == replace("onboardai-intake$NAME_SUFFIX", "$NAME_SUFFIX", "-staging") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "--mcp-token-secret \"onboardai-intake-mcp-token$NAME_SUFFIX\"") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "--location \"$INTAKE_AGENT_LOCATION\"")
    )
    error_message = "The intake agent deploy flags in deploy.yml must name the display name, service account, secret and region Terraform prepared."
  }

  # The workflow owns the job's image (this commit's api image) and Terraform
  # ignores it, so neither an apply nor a deploy undoes the other.
  assert {
    condition = (
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "--image=\"$REGISTRY/onboardai$NAME_SUFFIX/api:$GITHUB_SHA\" --quiet") &&
      can(regex("resource \"google_cloud_run_v2_job\" \"db_migrate\" \\{(?s:.*?)ignore_changes = \\[\\n(?:      [^\\n]*\\n)*?      template\\[0\\]\\.template\\[0\\]\\.containers\\[0\\]\\.image,", file("${path.module}/accounts.tf")))
    )
    error_message = "The migration job must run this commit's api image, and Terraform must ignore the job's image."
  }
}

# The deploy workflow gives the api its Cloud SQL connection
# (--set-cloudsql-instances), which Cloud Run stores as a volume mounted at
# /cloudsql. Terraform must ignore it, or the next apply would remove the
# api's database connection.
run "terraform_leaves_the_api_cloud_sql_connection_to_the_workflow" {
  command = plan

  assert {
    condition = (
      can(regex("resource \"google_cloud_run_v2_service\" \"service\" \\{(?s:.*?)ignore_changes = \\[\\n(?:      [^\\n]*\\n)*?      template\\[0\\]\\.volumes,\\n      template\\[0\\]\\.containers\\[0\\]\\.volume_mounts,\\n", file("${path.module}/cloud_run.tf"))) &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "--set-cloudsql-instances=")
    )
    error_message = "google_cloud_run_v2_service.service must ignore template[0].volumes and template[0].containers[0].volume_mounts, which the workflow's --set-cloudsql-instances sets."
  }
}
