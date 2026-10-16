# Employee accounts (#23, #30): a Cloud SQL for PostgreSQL instance holds the
# accounts, sessions and account events; profiles and drafts stay in the
# environment's Firestore database. Everything here exists only where
# local.employee_accounts is true (staging today), so production's plan is
# unchanged.
#
#   api (Cloud Run) --Cloud SQL connection, Unix socket /cloudsql/<connection name>--> onboardai-db-<env>
#   DATABASE_URL = postgresql://onboardai:<password>@/onboardai?host=/cloudsql/<connection name>
#
# The password is generated during apply (ephemeral, never in state) and sent
# through write-only arguments to the database user, the password secret and
# the DATABASE_URL secret in the same apply. It reaches them again only when
# var.db_password_version changes (rotation). The api and the migration job
# read DATABASE_URL as a Secret Manager reference; nobody but project owners
# (the HR bootstrap, README) reads the password secret.

# --- Instance ---------------------------------------------------------------

# Smallest suitable instance for a staging accounts database:
# - Enterprise edition, db-f1-micro (shared vCPU, 0.6 GiB): the cheapest tier.
#   PostgreSQL 16+ defaults to Enterprise Plus, which has no shared-core tiers,
#   so the edition is explicit. Shared-core tiers have no SLA and allow 25
#   connections: enough for one api instance (max 1) and the migration job.
# - Zonal, 10 GiB SSD (the minimum), growing on its own up to 20 GiB at most.
# - PostgreSQL 17, the version the local stack (#23) runs.
# - Backups: daily, 3 kept, no point-in-time recovery (no WAL archive).
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
      point_in_time_recovery_enabled = false
      start_time                     = "18:00" # UTC: 02:00 in Singapore

      backup_retention_settings {
        retained_backups = 3
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

  depends_on = [google_project_service.accounts]
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
# own service account, through the same Cloud SQL connection and DATABASE_URL.
# Terraform creates it with a placeholder image; before each api deploy the
# deploy workflow points it at the new api image and executes it with --wait,
# so the schema is migrated before the new revision takes traffic. The
# password stays in Secret Manager and Cloud Run: it never reaches the runner
# or the workflow log. The job's own output goes to Cloud Logging.
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
      timeout               = "300s"
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
