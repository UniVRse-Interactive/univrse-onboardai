# Offline checks of production's employee accounts database (issue #45):
# `terraform test` in terraform/onboardai. Production (var.environment's
# default) gets the same accounts resources as staging (tests/accounts.tftest.hcl),
# without a suffix, with production's labels and longer backups, and none of
# the intake agent. Providers are mocked as in tests/onboardai.tftest.hcl; the
# random provider is real (it only generates values locally).

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

override_resource {
  target = google_service_account.checklist_agent[0]
  values = {
    email = "onboardai-checklist@onboardai-test-123.iam.gserviceaccount.com"
    name  = "projects/onboardai-test-123/serviceAccounts/onboardai-checklist@onboardai-test-123.iam.gserviceaccount.com"
  }
}

override_resource {
  target = google_service_account.deployer
  values = {
    email = "onboardai-deployer@onboardai-test-123.iam.gserviceaccount.com"
    name  = "projects/onboardai-test-123/serviceAccounts/onboardai-deployer@onboardai-test-123.iam.gserviceaccount.com"
  }
}

override_resource {
  target = google_service_account.runtime["web"]
  values = {
    email = "onboardai-web-run@onboardai-test-123.iam.gserviceaccount.com"
    name  = "projects/onboardai-test-123/serviceAccounts/onboardai-web-run@onboardai-test-123.iam.gserviceaccount.com"
  }
}

override_resource {
  target = google_service_account.runtime["api"]
  values = {
    email = "onboardai-api-run@onboardai-test-123.iam.gserviceaccount.com"
    name  = "projects/onboardai-test-123/serviceAccounts/onboardai-api-run@onboardai-test-123.iam.gserviceaccount.com"
  }
}

override_resource {
  target = google_service_account.runtime["tts"]
  values = {
    email = "onboardai-tts-run@onboardai-test-123.iam.gserviceaccount.com"
    name  = "projects/onboardai-test-123/serviceAccounts/onboardai-tts-run@onboardai-test-123.iam.gserviceaccount.com"
  }
}

override_resource {
  target = google_sql_database_instance.accounts[0]
  values = {
    connection_name = "onboardai-test-123:asia-southeast1:onboardai-db"
  }
}

override_resource {
  target = google_secret_manager_secret.accounts["database_url"]
  values = {
    id = "projects/onboardai-test-123/secrets/onboardai-database-url"
  }
}

override_resource {
  target = google_secret_manager_secret.accounts["db_password"]
  values = {
    id = "projects/onboardai-test-123/secrets/onboardai-db-password"
  }
}

# --- Cloud SQL ---------------------------------------------------------------

run "production_accounts_instance_matches_staging_with_longer_backups" {
  command = apply

  assert {
    condition = (
      google_sql_database_instance.accounts[0].name == "onboardai-db" &&
      google_sql_database_instance.accounts[0].region == "asia-southeast1" &&
      google_sql_database_instance.accounts[0].database_version == "POSTGRES_17" &&
      google_sql_database_instance.accounts[0].settings[0].edition == "ENTERPRISE" &&
      google_sql_database_instance.accounts[0].settings[0].tier == "db-f1-micro" &&
      google_sql_database_instance.accounts[0].settings[0].availability_type == "ZONAL" &&
      google_sql_database_instance.accounts[0].settings[0].disk_size == 10 &&
      google_sql_database_instance.accounts[0].settings[0].disk_autoresize_limit == 20
    )
    error_message = "Production accounts: onboardai-db, asia-southeast1, PostgreSQL 17, Enterprise db-f1-micro, zonal, 10 GiB growing to 20 GiB at most (staging's shape)."
  }

  assert {
    condition = (
      google_sql_database_instance.accounts[0].settings[0].ip_configuration[0].ipv4_enabled == true &&
      length(google_sql_database_instance.accounts[0].settings[0].ip_configuration[0].authorized_networks) == 0 &&
      google_sql_database_instance.accounts[0].settings[0].ip_configuration[0].ssl_mode == "ENCRYPTED_ONLY" &&
      google_sql_database_instance.accounts[0].settings[0].connector_enforcement == "REQUIRED"
    )
    error_message = "No authorized network: only the Cloud Run connection and the Cloud SQL Auth Proxy (connector enforcement), TLS for anything else."
  }

  # A week of daily backups and point-in-time recovery over that week.
  assert {
    condition = (
      google_sql_database_instance.accounts[0].settings[0].backup_configuration[0].enabled == true &&
      google_sql_database_instance.accounts[0].settings[0].backup_configuration[0].point_in_time_recovery_enabled == true &&
      google_sql_database_instance.accounts[0].settings[0].backup_configuration[0].transaction_log_retention_days == 7 &&
      google_sql_database_instance.accounts[0].settings[0].backup_configuration[0].backup_retention_settings[0].retained_backups == 7 &&
      google_sql_database_instance.accounts[0].settings[0].backup_configuration[0].backup_retention_settings[0].retention_unit == "COUNT"
    )
    error_message = "Production backups: daily, seven kept, point-in-time recovery over 7 days."
  }

  assert {
    condition = (
      google_sql_database_instance.accounts[0].deletion_protection == true &&
      google_sql_database_instance.accounts[0].settings[0].deletion_protection_enabled == true &&
      google_sql_database.accounts[0].deletion_policy == "ABANDON" &&
      google_sql_database.accounts[0].name == "onboardai" &&
      google_sql_database.accounts[0].instance == "onboardai-db" &&
      google_sql_user.accounts[0].name == "onboardai" &&
      google_sql_user.accounts[0].instance == "onboardai-db" &&
      tostring(google_sql_user.accounts[0].password_wo_version) == "1"
    )
    error_message = "Deletion protection on in Terraform and Cloud SQL; the onboardai database is only abandoned while protected; the onboardai user's password is write-only."
  }

  # Production resources carry no environment label (locals.tf).
  assert {
    condition     = google_sql_database_instance.accounts[0].settings[0].user_labels == tomap({ app = "onboardai", managed-by = "terraform", component = "accounts" })
    error_message = "The production instance carries app, managed-by and component labels only."
  }

  # The Cloud SQL Admin API is managed by production's state with the others.
  assert {
    condition = (
      contains(keys(google_project_service.required), "sqladmin.googleapis.com") &&
      google_project_service.required["sqladmin.googleapis.com"].disable_on_destroy == false
    )
    error_message = "Production's state enables sqladmin.googleapis.com and never disables it on destroy."
  }
}

# --- Secrets and grants ---------------------------------------------------------

run "production_accounts_secrets_and_grants" {
  command = apply

  assert {
    condition = (
      { for k, s in google_secret_manager_secret.accounts : k => s.secret_id } == { db_password = "onboardai-db-password", database_url = "onboardai-database-url" } &&
      alltrue([
        for s in values(google_secret_manager_secret.accounts) :
        length(s.replication[0].user_managed[0].replicas) == 1 && s.replication[0].user_managed[0].replicas[0].location == "asia-southeast1" && !contains(keys(s.labels), "environment")
      ]) &&
      google_secret_manager_secret_version.db_password[0].secret == google_secret_manager_secret.accounts["db_password"].id &&
      google_secret_manager_secret_version.database_url[0].secret == google_secret_manager_secret.accounts["database_url"].id &&
      tostring(google_secret_manager_secret_version.database_url[0].secret_data_wo_version) == "1"
    )
    error_message = "Production has onboardai-db-password and onboardai-database-url, replicated in asia-southeast1 only, each with a write-only version."
  }

  assert {
    condition = (
      google_secret_manager_secret_iam_member.api_reads_database_url[0].secret_id == google_secret_manager_secret.accounts["database_url"].id &&
      google_secret_manager_secret_iam_member.api_reads_database_url[0].member == "serviceAccount:onboardai-api-run@onboardai-test-123.iam.gserviceaccount.com" &&
      google_secret_manager_secret_iam_member.api_reads_database_url[0].role == "roles/secretmanager.secretAccessor"
    )
    error_message = "onboardai-api-run (the api and the migration job) reads onboardai-database-url, and nobody reads the bare password."
  }

  # Cloud SQL Client on onboardai-db only (#45); since #56 Firestore on
  # (default) only and no Discovery Engine role on the project; Gemini stays
  # unconditioned.
  assert {
    condition = (
      toset(keys(google_project_iam_member.api_runtime)) == toset(["roles/aiplatform.user", "roles/datastore.user", "roles/cloudsql.client", "roles/discoveryengine.editor"]) &&
      google_project_iam_member.api_runtime["roles/cloudsql.client"].condition[0].expression == "resource.name == \"projects/onboardai-test-123/instances/onboardai-db\" && resource.type == \"sqladmin.googleapis.com/Instance\"" &&
      google_project_iam_member.api_runtime["roles/cloudsql.client"].member == "serviceAccount:onboardai-api-run@onboardai-test-123.iam.gserviceaccount.com" &&
      length(google_project_iam_member.api_runtime["roles/datastore.user"].condition) == 1 &&
      length(google_project_iam_member.api_runtime["roles/aiplatform.user"].condition) == 0 &&
      length(google_project_iam_member.api_runtime["roles/discoveryengine.editor"].condition) == 0
    )
    error_message = "Production's api holds roles/cloudsql.client on onboardai-db only, roles/datastore.user with its database condition, and roles/aiplatform.user and roles/discoveryengine.editor unconditioned."
  }

  assert {
    condition = (
      output.accounts_secret_ids == {
        db_password      = "onboardai-db-password"
        database_url     = "onboardai-database-url"
        intake_mcp_token = null
      } &&
      output.cloud_sql_instance_connection_name == "onboardai-test-123:asia-southeast1:onboardai-db"
    )
    error_message = "The production outputs name the two accounts secrets (no intake token) and the instance, never a value."
  }
}

# --- Migration job and its log ------------------------------------------------

run "production_migration_job_migrates_cloud_sql_and_default_firestore" {
  command = apply

  assert {
    condition = (
      google_cloud_run_v2_job.db_migrate[0].name == "onboardai-db-migrate" &&
      google_cloud_run_v2_job.db_migrate[0].location == "asia-southeast1" &&
      google_cloud_run_v2_job.db_migrate[0].deletion_protection == true &&
      google_cloud_run_v2_job.db_migrate[0].template[0].template[0].service_account == "onboardai-api-run@onboardai-test-123.iam.gserviceaccount.com" &&
      google_cloud_run_v2_job.db_migrate[0].template[0].template[0].containers[0].image == "us-docker.pkg.dev/cloudrun/container/hello" &&
      google_cloud_run_v2_job.db_migrate[0].template[0].template[0].containers[0].args == tolist(["run", "db:migrate"]) &&
      google_cloud_run_v2_job.db_migrate[0].template[0].template[0].timeout == "600s" &&
      google_cloud_run_v2_job.db_migrate[0].template[0].template[0].max_retries == 1 &&
      output.db_migrate_job_name == "onboardai-db-migrate"
    )
    error_message = "onboardai-db-migrate runs npm run db:migrate as onboardai-api-run with 600 s per attempt and one retry, starts from the placeholder image (the deploy sets the real one) and is delete-protected."
  }

  assert {
    condition = (
      { for e in google_cloud_run_v2_job.db_migrate[0].template[0].template[0].containers[0].env : e.name => e.value == null ? "(no value)" : e.value } == {
        DATABASE_URL          = "(no value)"
        FIRESTORE_DATABASE_ID = "(default)"
        GOOGLE_CLOUD_PROJECT  = "onboardai-test-123"
        MIGRATION_TARGETS     = "sql,firestore"
      } &&
      one(flatten([for e in google_cloud_run_v2_job.db_migrate[0].template[0].template[0].containers[0].env : [for v in e.value_source : [for r in v.secret_key_ref : "${e.name}=${r.secret}@${r.version}"]]])) == "DATABASE_URL=onboardai-database-url@latest" &&
      one([for e in google_cloud_run_v2_job.db_migrate[0].template[0].template[0].containers[0].env : e.value if e.name == "FIRESTORE_DATABASE_ID"]) == google_firestore_database.default.name
    )
    error_message = "The production job reads DATABASE_URL from onboardai-database-url and migrates the (default) Firestore database, with MIGRATION_TARGETS=sql,firestore."
  }

  assert {
    condition = (
      toset(flatten([for v in google_cloud_run_v2_job.db_migrate[0].template[0].template[0].volumes : [for c in v.cloud_sql_instance : c.instances]])) == toset(["onboardai-test-123:asia-southeast1:onboardai-db"]) &&
      [for m in google_cloud_run_v2_job.db_migrate[0].template[0].template[0].containers[0].volume_mounts : m.mount_path] == ["/cloudsql"]
    )
    error_message = "The production job reaches onboardai-db through its Cloud SQL connection at /cloudsql."
  }

  # Its account may write (default): production's roles/datastore.user is
  # limited to exactly the database the job migrates (#56).
  assert {
    condition = (
      google_project_iam_member.api_runtime["roles/datastore.user"].member == "serviceAccount:${google_cloud_run_v2_job.db_migrate[0].template[0].template[0].service_account}" &&
      google_project_iam_member.api_runtime["roles/datastore.user"].condition[0].expression == join(" || ", [
        for p in ["onboardai-test-123", "123456789012"] :
        "resource.name == \"projects/${p}/databases/${one([for e in google_cloud_run_v2_job.db_migrate[0].template[0].template[0].containers[0].env : e.value if e.name == "FIRESTORE_DATABASE_ID"])}\""
      ])
    )
    error_message = "The production job's account holds roles/datastore.user on exactly the database it migrates, (default)."
  }

  assert {
    condition = (
      google_cloud_run_v2_job_iam_member.deployer_runs_migrations[0].name == "onboardai-db-migrate" &&
      google_cloud_run_v2_job_iam_member.deployer_runs_migrations[0].role == "roles/run.developer" &&
      google_cloud_run_v2_job_iam_member.deployer_runs_migrations[0].member == "serviceAccount:onboardai-deployer@onboardai-test-123.iam.gserviceaccount.com"
    )
    error_message = "The production deployer may update and execute onboardai-db-migrate, on that job only."
  }

  assert {
    condition = (
      google_logging_log_view.db_migrate[0].name == "onboardai-db-migrate" &&
      google_logging_log_view.db_migrate[0].bucket == "_Default" &&
      google_logging_log_view.db_migrate[0].filter == "SOURCE(\"projects/onboardai-test-123\") AND resource.type = \"cloud_run_job\" AND resource.labels.job_name = \"onboardai-db-migrate\"" &&
      google_logging_log_view_iam_member.deployer_reads_migration_log[0].name == "onboardai-db-migrate" &&
      google_logging_log_view_iam_member.deployer_reads_migration_log[0].role == "roles/logging.viewAccessor" &&
      google_logging_log_view_iam_member.deployer_reads_migration_log[0].member == "serviceAccount:onboardai-deployer@onboardai-test-123.iam.gserviceaccount.com" &&
      output.db_migrate_log_view == "onboardai-db-migrate"
    )
    error_message = "The production deployer reads the output of onboardai-db-migrate, and nothing else, through the log view onboardai-db-migrate."
  }
}

# --- No intake agent in production ---------------------------------------------

run "production_has_no_intake_agent" {
  command = apply

  assert {
    condition = (
      length(google_service_account.intake_agent) == 0 &&
      length(google_project_iam_member.intake_agent_runtime) == 0 &&
      length(google_secret_manager_secret.intake_mcp_token) == 0 &&
      length(google_secret_manager_secret_version.intake_mcp_token) == 0 &&
      length(google_secret_manager_secret_iam_member.intake_mcp_token) == 0 &&
      length(google_service_account_iam_member.deployer_acts_as_intake_agent) == 0 &&
      length(google_firestore_field.employee_imports_ttl) == 0 &&
      length(google_cloud_run_v2_service_iam_member.intake_agent_invokes_api) == 0
    )
    error_message = "Production gets none of the intake agent's resources (runtime account, Gemini role, MCP token, act-as grant, draft-import TTL, api invoker)."
  }

  assert {
    condition = (
      output.intake_agent_service_account_email == null &&
      output.intake_agent_deploy_settings == null
    )
    error_message = "The intake agent outputs are null in production."
  }
}

# --- deploy.yml uses production's names ------------------------------------------

# NAME_SUFFIX is empty on main (tests/workflows.tftest.hcl).
run "deploy_workflow_uses_production_names" {
  command = apply

  assert {
    condition = (
      replace("onboardai-db-migrate$NAME_SUFFIX", "$NAME_SUFFIX", "") == google_cloud_run_v2_job.db_migrate[0].name &&
      replace("onboardai-db-migrate$NAME_SUFFIX", "$NAME_SUFFIX", "") == google_logging_log_view.db_migrate[0].name &&
      google_sql_database_instance.accounts[0].connection_name == "${var.project_id}:${var.region}:${replace("onboardai-db$NAME_SUFFIX", "$NAME_SUFFIX", "")}" &&
      google_secret_manager_secret.accounts["database_url"].secret_id == replace("onboardai-database-url$NAME_SUFFIX", "$NAME_SUFFIX", "") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "job=\"onboardai-db-migrate$NAME_SUFFIX\"\n") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "view=\"onboardai-db-migrate$NAME_SUFFIX\"\n") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "--set-cloudsql-instances=\"$GCP_PROJECT_ID:$GCP_REGION:onboardai-db$NAME_SUFFIX\"") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "api_secrets=\"DATABASE_URL=onboardai-database-url$NAME_SUFFIX:latest\"\n")
    )
    error_message = "The migration job, its log view, the Cloud SQL connection and DATABASE_URL that deploy.yml computes with an empty NAME_SUFFIX must be the ones Terraform creates for production."
  }
}

run "production_deletion_protection_can_be_lifted_for_tear_down" {
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
    error_message = "deletion_protection = false lifts the production instance, database and job guards for a tear down."
  }
}
