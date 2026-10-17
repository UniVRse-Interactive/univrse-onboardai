# Cloud Monitoring alerts, emailed to var.alert_emails.
#
# Every environment gets its own channels, uptime checks and the three
# policies, watching its own services only. Staging's carry "[staging]" in
# every title, so a staging alert is never mistaken for a production one. (A
# switch to leave staging without alerts would need count on these single
# resources, which would move production's addresses.)
#
# Cheap: three policies with one condition each, on Cloud Run's built-in
# metrics and two uptime checks (cost below the checks).
# Quiet: they watch request metrics and check results only, never their
# absence. A service scaled to zero sends no data, missing data counts as "no
# violation" (EVALUATION_MISSING_DATA_INACTIVE), and an open incident closes
# after 30 minutes without data.

resource "google_monitoring_notification_channel" "email" {
  for_each = toset(var.alert_emails)

  display_name = "${local.display_name} alerts: ${each.value}"
  type         = "email"
  labels = {
    email_address = each.value
  }
  user_labels = local.labels

  depends_on = [google_project_service.required]
}

locals {
  alert_notification_channels = [for c in google_monitoring_notification_channel.email : c.name]

  # Services whose 5xx responses alert. web is left out: it proxies the API,
  # so an API failure would alert twice.
  alert_5xx_services = [local.services.api.name, local.services.tts.name]
}

# 5xx responses that keep coming for 5 minutes on the api or tts service:
# every 1-minute window of the last 5 holds at least one 5xx. One incident per
# service (grouped by service_name). A single failed request does not alert.
resource "google_monitoring_alert_policy" "server_errors" {
  display_name          = "${local.display_name}: sustained 5xx responses (api, tts)"
  combiner              = "OR"
  severity              = "ERROR"
  notification_channels = local.alert_notification_channels
  user_labels           = local.labels

  conditions {
    display_name = "5xx responses on ${local.services.api.name} or ${local.services.tts.name} for 5 minutes"

    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"cloud_run_revision\"",
        "resource.label.service_name = one_of(${join(", ", [for s in local.alert_5xx_services : "\"${s}\""])})",
        "metric.type = \"run.googleapis.com/request_count\"",
        "metric.label.response_code_class = \"5xx\"",
      ])

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.service_name"]
      }

      comparison              = "COMPARISON_GT"
      threshold_value         = 0
      duration                = "300s"
      evaluation_missing_data = "EVALUATION_MISSING_DATA_INACTIVE"

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    mime_type = "text/markdown"
    subject   = "${local.display_name}: 5xx responses on $${resource.label.service_name}"
    content   = <<-EOT
      $${resource.label.service_name} has answered with 5xx for 5 minutes.
      Check its logs in Cloud Run (Logs tab) for the failing requests. If a new
      revision is the cause, roll back as in terraform/onboardai/README.md (Roll back).
    EOT
  }

  depends_on = [google_project_service.required]
}

# p95 request latency of the api service above 20 s, measured over 5 minutes.
# Requests that stream an answer count until the stream ends.
resource "google_monitoring_alert_policy" "api_latency" {
  display_name          = "${local.display_name}: ${local.services.api.name} p95 latency above 20 s"
  combiner              = "OR"
  severity              = "WARNING"
  notification_channels = local.alert_notification_channels
  user_labels           = local.labels

  conditions {
    display_name = "${local.services.api.name} p95 request latency > 20 s over 5 minutes"

    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"cloud_run_revision\"",
        "resource.label.service_name = \"${local.services.api.name}\"",
        "metric.type = \"run.googleapis.com/request_latencies\"",
      ])

      # request_latencies is a distribution in milliseconds. ALIGN_DELTA keeps
      # each 5-minute distribution; REDUCE_PERCENTILE_95 merges every revision
      # and response code before taking the 95th percentile.
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_DELTA"
        cross_series_reducer = "REDUCE_PERCENTILE_95"
        group_by_fields      = ["resource.label.service_name"]
      }

      comparison      = "COMPARISON_GT"
      threshold_value = 20000
      # The API rejects evaluation_missing_data with a zero duration, so this is
      # the smallest useful window: one 300 s alignment period is already the
      # smoothing, and 60 s adds no extra wait beyond the first violating point.
      duration                = "60s"
      evaluation_missing_data = "EVALUATION_MISSING_DATA_INACTIVE"

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    mime_type = "text/markdown"
    subject   = "${local.display_name}: ${local.services.api.name} p95 latency above 20 s"
    content   = <<-EOT
      ${local.services.api.name}'s p95 request latency over the last 5 minutes is above 20 s.
      Check the Gemini and Vertex AI Search calls in the service logs, and
      whether the single instance (max 1) is saturated.
    EOT
  }

  depends_on = [google_project_service.required]
}

# --- Uptime checks (#56) -------------------------------------------------------

# Two HTTPS checks on the web service's run.app host, both through web:
# /web-health (web itself) and /api/health, which web proxies to the api, so it
# tests web, the proxy and the api together and keeps working once the api is
# no longer public (#57). Both answer {"ok":true} and touch no database.
#
# Cost: three checker locations (the fewest the API accepts) every 5 minutes
# is 25,920 executions a month per check; two checks in each of the two stacks
# make 103,680, inside the 1 million free executions a month (USD 0.30 per
# 1,000 beyond). Each check is also a Cloud Run request (about one every 100 s
# per check): a few milliseconds of request-based billing, inside the free
# tier. It keeps web and the api warm, so fewer users meet a cold start.
locals {
  # Known at plan time: the web service exists before any check is created.
  uptime_host = trimprefix(google_cloud_run_v2_service.service["web"].uri, "https://")

  uptime_checks = {
    web = {
      path        = local.services.web.health_path
      description = "${local.services.web.name} ${local.services.web.health_path}"
    }
    api = {
      path        = local.services.api.health_path
      description = "${local.services.api.name} ${local.services.api.health_path} through ${local.services.web.name}"
    }
  }
}

resource "google_monitoring_uptime_check_config" "health" {
  for_each = local.uptime_checks

  display_name = "${local.display_name}: ${each.value.description}"
  period       = "300s"
  # Covers a cold start of web and the api together.
  timeout = "30s"
  # One location each in Asia Pacific (next to the services), Europe and the
  # USA: three, the minimum.
  selected_regions   = ["ASIA_PACIFIC", "EUROPE", "USA_OREGON"]
  checker_type       = "STATIC_IP_CHECKERS"
  log_check_failures = true
  user_labels        = local.labels

  http_check {
    request_method = "GET"
    path           = each.value.path
    port           = 443
    use_ssl        = true
    validate_ssl   = true

    accepted_response_status_codes {
      status_class = "STATUS_CLASS_2XX"
    }
  }

  # A 200 with any other body (the web app's HTML in place of the api's
  # answer, say) fails the check.
  content_matchers {
    content = "\"ok\":true"
    matcher = "CONTAINS_STRING"
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = local.uptime_host
    }
  }

  depends_on = [google_project_service.required]
}

# A check failing from at least two of its three locations for 5 minutes: the
# latest result of each location (ALIGN_NEXT_OLDER over 10 minutes, twice the
# period), counted when false, per check. One location's network trouble does
# not alert. Checks run whatever the services' scale, so their data never
# stops while the checks exist.
resource "google_monitoring_alert_policy" "uptime" {
  display_name          = "${local.display_name}: uptime checks failing (${local.services.web.health_path}, ${local.services.api.health_path})"
  combiner              = "OR"
  severity              = "CRITICAL"
  notification_channels = local.alert_notification_channels
  user_labels           = local.labels

  conditions {
    display_name = "An uptime check of ${local.services.web.name} fails from 2 of 3 locations for 5 minutes"

    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"uptime_url\"",
        "metric.type = \"monitoring.googleapis.com/uptime_check/check_passed\"",
        "metric.label.check_id = one_of(${join(", ", [for c in google_monitoring_uptime_check_config.health : "\"${c.uptime_check_id}\""])})",
      ])

      aggregations {
        alignment_period     = "600s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["metric.label.check_id"]
      }

      comparison              = "COMPARISON_GT"
      threshold_value         = 1
      duration                = "300s"
      evaluation_missing_data = "EVALUATION_MISSING_DATA_INACTIVE"

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    mime_type = "text/markdown"
    subject   = "${local.display_name}: uptime check $${metric.label.check_id} failing"
    content   = <<-EOT
      Uptime check $${metric.label.check_id} on https://${local.uptime_host} has failed from at least two of its three locations for 5 minutes.
      ${local.services.web.health_path} failing means ${local.services.web.name} is down; ${local.services.api.health_path} alone failing means ${local.services.api.name} or the proxy to it.
      Check the services' logs in Cloud Run and the check's failed probes in Cloud Logging. If a new
      revision is the cause, roll back as in terraform/onboardai/README.md (Roll back).
    EOT
  }

  depends_on = [google_project_service.required]
}
