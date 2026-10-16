# The three services exist before the first deploy so the deployer can be
# granted Cloud Run Developer on each one instead of on the project. Terraform
# owns their shape (identity, resources, scaling, probe, ingress, public access);
# the deploy workflow owns the image, environment variables, secrets, Cloud SQL
# connections and traffic.
# Staging's three (onboardai-<service>-staging) have the same shape.
resource "google_cloud_run_v2_service" "service" {
  for_each = local.services

  name        = each.value.name
  location    = var.region
  description = each.value.description
  ingress     = "INGRESS_TRAFFIC_ALL"
  labels      = merge(local.labels, { component = each.key })

  # Terraform refuses to delete a service while this is true (see README, Tear down).
  deletion_protection = var.deletion_protection

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
      # The deploy workflow's --set-cloudsql-instances (staging's api, #30),
      # which Cloud Run stores as a Cloud SQL volume mounted at /cloudsql.
      template[0].volumes,
      template[0].containers[0].volume_mounts,
      # A manual rollback pins traffic to an older revision; apply must not undo it.
      traffic,
    ]
  }

  depends_on = [google_project_service.required]
}

# --- Who may call each service (#57) -------------------------------------------
#
# Only web is public. api and tts are private: Cloud Run accepts a request only
# with a Google-signed ID token (in X-Serverless-Authorization, so the app keeps
# Authorization) of a principal that holds roles/run.invoker on the service.
# Ingress stays "all" (--ingress=all): Cloud Run IAM does the gating, and the
# services keep their run.app URLs.
#
#   browser --(no token)--> web --(ID token of onboardai-web-run)--> api
#   api --(ID token of onboardai-api-run)--> tts
#   intake agent (staging) --(ID token of onboardai-intake-staging)--> api /mcp
#
# Each service mints its own token from the metadata server, with the target's
# origin as audience; nothing else is needed for that. The deployer reaches the
# private services through its Cloud Run Developer role (below), which includes
# run.routes.invoke: the smoke test uses that for POST /mcp.
#
# Rollout (README, Private api and tts): deploy the app first (it sends ID
# tokens whenever it runs on Cloud Run and the target is https), then apply
# the invoker grants with -target, then the rest, which removes allUsers from
# the api and tts. One apply cannot order that removal (a key leaving
# public_invoker) after the grants' creation. To make a service public again,
# re-add it to public_services and apply.

locals {
  # allUsers holds roles/run.invoker on these services only.
  public_services = ["web"]

  # caller => callee by runtime account: web calls the api, the api calls tts.
  service_hops = {
    "web-to-api" = { caller = "web", callee = "api" }
    "api-to-tts" = { caller = "api", callee = "tts" }
  }
}

# An IAM binding rather than invoker_iam_disabled: toggling that flag needs
# run.services.setIamPolicy, which the deployer does not have, and deploys
# never touch IAM because the workflow passes no --allow-unauthenticated flag.
# web keeps the key it was applied with; the api's and tts's bindings go.
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  for_each = { for key, service in google_cloud_run_v2_service.service : key => service if contains(local.public_services, key) }

  project  = each.value.project
  location = each.value.location
  name     = each.value.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# The runtime account of each caller may invoke its callee, and no other
# service. The intake agent's grant on the api is in intake_agent.tf.
resource "google_cloud_run_v2_service_iam_member" "runtime_invoker" {
  for_each = local.service_hops

  project  = google_cloud_run_v2_service.service[each.value.callee].project
  location = google_cloud_run_v2_service.service[each.value.callee].location
  name     = google_cloud_run_v2_service.service[each.value.callee].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.runtime[each.value.caller].email}"
}

resource "google_cloud_run_v2_service_iam_member" "deployer" {
  for_each = google_cloud_run_v2_service.service

  project  = each.value.project
  location = each.value.location
  name     = each.value.name
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.deployer.email}"
}
