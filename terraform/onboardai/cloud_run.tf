# The three services exist before the first deploy so the deployer can be
# granted Cloud Run Developer on each one instead of on the project. Terraform
# owns their shape (identity, resources, scaling, probe, ingress, public access);
# the deploy workflow owns the image, environment variables, secrets and traffic.
resource "google_cloud_run_v2_service" "service" {
  for_each = local.services

  name        = each.value.name
  location    = var.region
  description = each.value.description
  ingress     = "INGRESS_TRAFFIC_ALL"
  labels      = merge(local.labels, { component = each.key })

  # Terraform refuses to delete a service while this is true (see README, Tear down).
  deletion_protection = true

  template {
    service_account                  = google_service_account.runtime[each.key].email
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    timeout                          = "${each.value.timeout_seconds}s"
    max_instance_request_concurrency = each.value.concurrency

    scaling {
      min_instance_count = each.value.min_instances
      max_instance_count = each.value.max_instances
    }

    containers {
      # Google's public sample; replaced by the first deploy.
      image = local.placeholder_image

      ports {
        container_port = local.container_port
      }

      resources {
        limits = {
          cpu    = each.value.cpu
          memory = each.value.memory
        }
        cpu_idle          = true # CPU only while serving requests (request-based billing)
        startup_cpu_boost = each.value.cpu_boost
      }

      startup_probe {
        initial_delay_seconds = 0
        period_seconds        = local.probe_period_seconds
        timeout_seconds       = local.probe_timeout_seconds
        failure_threshold     = each.value.startup_failure_threshold

        http_get {
          path = each.value.health_path
          port = local.container_port
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    ignore_changes = [
      # Set by every `gcloud run deploy`.
      client,
      client_version,
      template[0].revision,
      template[0].labels,
      template[0].annotations,
      template[0].containers[0].image,
      template[0].containers[0].env,
      # A manual rollback pins traffic to an older revision; apply must not undo it.
      traffic,
    ]
  }

  depends_on = [google_project_service.required]
}

# Public invoker on all three services (user decision for the demo). An IAM
# binding rather than invoker_iam_disabled: toggling that flag needs
# run.services.setIamPolicy, which the deployer does not have, and deploys
# never touch IAM because the workflow passes no --allow-unauthenticated flag.
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  for_each = google_cloud_run_v2_service.service

  project  = each.value.project
  location = each.value.location
  name     = each.value.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "deployer" {
  for_each = google_cloud_run_v2_service.service

  project  = each.value.project
  location = each.value.location
  name     = each.value.name
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.deployer.email}"
}
