# Employee accounts (#23, #30, #45): a Cloud SQL for PostgreSQL instance holds
# the accounts, sessions and account events; profiles and drafts stay in the
# environment's Firestore database. Every environment has its own
# (local.employee_accounts, environment.tf): onboardai-db in production,
# onboardai-db-staging in staging.
#
#   api (Cloud Run) --Cloud SQL connection, Unix socket /cloudsql/<connection name>--> onboardai-db[-staging]
#   DATABASE_URL = postgresql://onboardai:<password>@/onboardai?host=/cloudsql/<connection name>
#
# The password is generated during apply (ephemeral, never in state) and sent
# through write-only arguments to the database user, the password secret and
# the DATABASE_URL secret in the same apply. It reaches them again only when
# var.db_password_version changes (rotation). The api and the migration job
# read DATABASE_URL as a Secret Manager reference; nobody but project owners
# (the HR bootstrap, README) reads the password secret.

# --- Instance ---------------------------------------------------------------

# Smallest suitable instance for an accounts database, in both environments:
# - Enterprise edition, db-f1-micro (shared vCPU, 0.6 GiB): the cheapest tier.
#   PostgreSQL 16+ defaults to Enterprise Plus, which has no shared-core tiers,
#   so the edition is explicit. Shared-core tiers have no SLA and allow 25
#   connections: enough for one api instance (max 1) and the migration job.
# - Zonal, 10 GiB SSD (the minimum), growing on its own up to 20 GiB at most.
# - PostgreSQL 17, the version the local stack (#23) runs.
# - Backups: daily (local.sql_backups). Staging keeps 3 and has no point-in-
#   time recovery; production keeps 7 and can be restored to any moment of
#   the last 7 days (write-ahead logs kept for point-in-time recovery).
# - Connections: public IP for the Cloud Run connection and the Cloud SQL Auth
#   Proxy only. No authorized network, connector enforcement (only the Auth
#   Proxy and the Cloud SQL connectors may connect; both authenticate with IAM),
#   and TLS required for anything else.
# - Two delete guards while var.deletion_protection is true, as Firestore:
#   Terraform refuses to destroy it, and Cloud SQL refuses any delete call.
resource "google_sql_database_instance" "accounts" {
  count = local.employee_accounts ? 1 : 0

  name             = local.sql_instance_name
  region           = var.region
  database_version = "POSTGRES_17"

  deletion_protection = var.deletion_protection

  settings {
    edition           = "ENTERPRISE"
    tier              = "db-f1-micro"
    availability_type = "ZONAL"
    user_labels       = merge(local.labels, { component = "accounts" })

    disk_type             = "PD_SSD"
    disk_size             = 10
    disk_autoresize       = true
    disk_autoresize_limit = 20

    deletion_protection_enabled = var.deletion_protection

    connector_enforcement = "REQUIRED"

    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
      # No authorized_networks block: no IP address may connect directly.
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = local.sql_backups.point_in_time_recovery_enabled
      transaction_log_retention_days = local.sql_backups.transaction_log_retention_days
      start_time                     = "18:00" # UTC: 02:00 in Singapore

      backup_retention_settings {
        retained_backups = local.sql_backups.retained_backups
        retention_unit   = "COUNT"
      }
    }

    # Sunday 19:00 UTC (Monday 03:00 in Singapore), outside working hours.
    maintenance_window {
      day          = 7
      hour         = 19
      update_track = "stable"
    }
  }

  depends_on = [google_project_service.required]
}

# deletion_policy ABANDON while protected, as Firestore: removing it from the
# configuration only drops it from state, the data stays.
resource "google_sql_database" "accounts" {
  count = local.employee_accounts ? 1 : 0

  name     = local.sql_database_name
  instance = google_sql_database_instance.accounts[0].name

  deletion_policy = var.deletion_protection ? "ABANDON" : "DELETE"
}

# --- Database user and its password -------------------------------------------

# Generated during each plan and apply, never stored. Letters and digits only,
# so it needs no escaping inside DATABASE_URL; 40 characters is about 238 bits.
ephemeral "random_password" "db" {
  count = local.employee_accounts ? 1 : 0

  length  = 40
  special = false
}

# Built-in PostgreSQL user (password login). The password is sent only when
# var.db_password_version changes. ABANDON: Cloud SQL cannot drop a PostgreSQL
# user that owns objects, and the instance's deletion removes it anyway.
resource "google_sql_user" "accounts" {
  count = local.employee_accounts ? 1 : 0

  name     = local.sql_user_name
  instance = google_sql_database_instance.accounts[0].name

  password_wo         = ephemeral.random_password.db[0].result
  password_wo_version = var.db_password_version

  deletion_policy = "ABANDON"
}

# --- Secrets ---------------------------------------------------------------

# Replicated in the stack's region only, like the rest of its data.
resource "google_secret_manager_secret" "accounts" {
  for_each = local.employee_accounts ? {
    db_password  = "Password of the ${local.sql_user_name} user of ${local.sql_instance_name}. Read by project owners for the HR bootstrap only."
    database_url = "DATABASE_URL of ${local.services.api.name} and ${local.db_migrate_job_name}: ${local.sql_database_name} on ${local.sql_instance_name} through the Cloud Run Cloud SQL connection (Unix socket)."
  } : {}

  secret_id = local.secret_ids[each.key]
  labels    = merge(local.labels, { component = "accounts" })

  # Shown in the console; no value.
  annotations = {
    description = each.value
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

# Written after the user, so a failed user creation leaves no secret version
# behind and a retry sends one consistent password to all three. Replaced
# together with the user (a renamed or recreated instance or user gets a new
# password everywhere in the same apply). create_before_destroy: the secret
# always has an enabled version, even during a rotation.
resource "google_secret_manager_secret_version" "db_password" {
  count = local.employee_accounts ? 1 : 0

  secret                 = google_secret_manager_secret.accounts["db_password"].id
  secret_data_wo         = ephemeral.random_password.db[0].result
  secret_data_wo_version = var.db_password_version

  depends_on = [google_sql_user.accounts]

  lifecycle {
    create_before_destroy = true
    replace_triggered_by  = [google_sql_user.accounts[0].id]
  }
}

resource "google_secret_manager_secret_version" "database_url" {
  count = local.employee_accounts ? 1 : 0

  secret                 = google_secret_manager_secret.accounts["database_url"].id
  secret_data_wo         = "postgresql://${google_sql_user.accounts[0].name}:${ephemeral.random_password.db[0].result}@/${google_sql_database.accounts[0].name}?host=/cloudsql/${google_sql_database_instance.accounts[0].connection_name}"
  secret_data_wo_version = var.db_password_version

  depends_on = [google_sql_user.accounts]

  lifecycle {
    create_before_destroy = true
    replace_triggered_by  = [google_sql_user.accounts[0].id]
  }
}

# The api reads DATABASE_URL (Cloud Run secret reference). It never reads the
# bare password.
resource "google_secret_manager_secret_iam_member" "api_reads_database_url" {
  count = local.employee_accounts ? 1 : 0

  secret_id = google_secret_manager_secret.accounts["database_url"].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime["api"].email}"
}

# --- Migration job ---------------------------------------------------------------

# Runs `npm run db:migrate` (safe to re-run) from the api image, as the api's
# own service account, through the same Cloud SQL connection and DATABASE_URL,
# then against the environment's Firestore database (#45): MIGRATION_TARGETS
# is sql,firestore, so the runner stops before touching either database when
# one of them is not configured. Terraform creates it with a placeholder
# image; before any service is deployed, the deploy workflow (main and
# staging) points it at the new api image and executes it with --wait, so the
# new revision never serves an unmigrated database, and a failed migration
# deploys nothing. The password stays in Secret Manager and Cloud Run: it
# never reaches the runner or the workflow log. The job's output goes to Cloud
# Logging; the workflow prints its migration lines through the log view below.
# Firestore access is the api account's roles/datastore.user (locals.tf):
# staging's is limited to onboardai-staging by its IAM condition.
resource "google_cloud_run_v2_job" "db_migrate" {
  count = local.employee_accounts ? 1 : 0

  name     = local.db_migrate_job_name
  location = var.region
  labels   = merge(local.labels, { component = "accounts" })

  deletion_protection = var.deletion_protection

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account       = google_service_account.runtime["api"].email
      execution_environment = "EXECUTION_ENVIRONMENT_GEN2"
      # A whole run (every pending SQL and Firestore file) gets 10 minutes, and
      # each Firestore file must finish within 5 (the runner's Firestore lease;
      # README, Database migrations). A retry after a killed attempt therefore
      # outlasts the lease the killed attempt left behind.
      timeout = "600s"
      # One retry absorbs a cold Cloud SQL connection; the migration takes an
      # advisory lock and skips applied files, so a retry is harmless.
      max_retries = 1

      containers {
        # Replaced by the deploy workflow (gcloud run jobs update --image).
        image   = local.placeholder_image
        command = ["npm"]
        args    = ["run", "db:migrate"]

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.accounts["database_url"].secret_id
              version = "latest"
            }
          }
        }

        # The runner's Firestore target (same rules as the api's Firestore
        # client): the environment's database, (default) in production.
        env {
          name  = "FIRESTORE_DATABASE_ID"
          value = local.firestore_database_name
        }

        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project_id
        }

        env {
          name  = "MIGRATION_TARGETS"
          value = local.db_migrate_targets
        }

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.accounts[0].connection_name]
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      # Set by every `gcloud run jobs update`.
      client,
      client_version,
      template[0].labels,
      template[0].annotations,
      template[0].template[0].containers[0].image,
    ]
  }

  # Cloud Run checks the secret and the connection when the job is created.
  depends_on = [
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_iam_member.api_reads_database_url,
    google_project_iam_member.api_runtime,
  ]
}

# The deployer updates the job's image and executes it (gcloud run jobs update,
# gcloud run jobs execute --wait), on this job only. It already acts as the
# api account (identity.tf), which the job runs as.
resource "google_cloud_run_v2_job_iam_member" "deployer_runs_migrations" {
  count = local.employee_accounts ? 1 : 0

  project  = google_cloud_run_v2_job.db_migrate[0].project
  location = google_cloud_run_v2_job.db_migrate[0].location
  name     = google_cloud_run_v2_job.db_migrate[0].name
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

# --- Migration log ----------------------------------------------------------------

# The deploy workflow prints which migration files an execution applied or
# found already applied (#45). The job writes them to stdout and stderr, which
# Cloud Logging keeps in the project's _Default bucket (30 days). This view
# shows the deployer the log entries of this environment's migration job and
# nothing else: no other job or service. That includes Cloud Run's system
# lines for the job ("Container called exit(0).") next to its stdout and
# stderr: a view filter must be a plain conjunction (the API rejects a
# parenthesised OR, "nesting depth limit of 1"), so it cannot list the two log
# IDs. Admin Activity audit logs stay in _Required. The workflow reads one
# execution through it (gcloud logging read --view) and prints only the
# runner's [sql], [firestore], "Migrations finished" and "Migration stopped"
# lines.
#
# parent, location and the bucket's short ID are given separately: the
# provider stores them in that form after create, so state equals the
# configuration and the grant below can use them.
resource "google_logging_log_view" "db_migrate" {
  count = local.employee_accounts ? 1 : 0

  parent      = "projects/${var.project_id}"
  location    = "global"
  bucket      = "_Default"
  name        = local.db_migrate_log_view_name
  description = "${local.display_name}: output of the Cloud Run job ${local.db_migrate_job_name} (database migrations), read by the deploy workflow."
  filter = join(" AND ", [
    "SOURCE(\"projects/${var.project_id}\")",
    "resource.type = \"cloud_run_job\"",
    "resource.labels.job_name = \"${local.db_migrate_job_name}\"",
  ])
}

# Logs View Accessor on that view only: no project-level logging role.
resource "google_logging_log_view_iam_member" "deployer_reads_migration_log" {
  count = local.employee_accounts ? 1 : 0

  parent   = google_logging_log_view.db_migrate[0].parent
  location = google_logging_log_view.db_migrate[0].location
  bucket   = google_logging_log_view.db_migrate[0].bucket
  name     = google_logging_log_view.db_migrate[0].name
  role     = "roles/logging.viewAccessor"
  member   = "serviceAccount:${google_service_account.deployer.email}"
}
