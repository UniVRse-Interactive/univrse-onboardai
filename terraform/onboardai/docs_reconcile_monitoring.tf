# Metrics and alerts for the company-document safeguards (#79). Everything
# goes to local.alert_notification_channels, the existing email channels, and
# watches this environment's own api service or reconcile job only. Staging's
# alerts say [staging] (local.display_name) and use WARNING instead of ERROR.
#
# Logging query precedence: OR binds tighter than AND, so every OR is in
# parentheses.
#
# Follow-ups, not built here: an ingestion SLA alert (a document searchable 15
# minutes after upload) and an alert on Discovery Engine's api_errors log, which
# today holds only the app's expected 404s.

locals {
  docs_sync_failures_metric        = "onboardai_docs_sync_failures${local.name_suffix}"
  docs_reconcile_items_metric      = "onboardai_docs_reconcile_items${local.name_suffix}"
  docs_reconcile_unrepaired_metric = "onboardai_docs_reconcile_unrepaired${local.name_suffix}"

  docs_alert_severity = local.is_production ? "ERROR" : "WARNING"

  # The api's sync lines (C-SYNC): one per HTTP request to Cloud Storage or
  # Discovery Engine, outcome failed when it did not succeed.
  docs_sync_failures_filter = join(" AND ", [
    "resource.type=\"cloud_run_revision\"",
    "resource.labels.service_name=\"${local.services.api.name}\"",
    "jsonPayload.event=\"onboardai_docs_sync\"",
    "jsonPayload.outcome=\"failed\"",
  ])

  # The job's item lines: one per piece of drift.
  docs_reconcile_items_filter = join(" AND ", [
    "resource.type=\"cloud_run_job\"",
    "resource.labels.job_name=\"${local.docs_reconcile_job_name}\"",
    "jsonPayload.event=\"onboardai_docs_reconcile_item\"",
  ])

  # Drift that is still there after the run: every kind except unmanaged (the
  # legacy files outside the <uuid>/ namespace, never touched) and pending
  # (younger than the grace period), minus what the run repaired (done).
  docs_reconcile_unrepaired_filter = join(" AND ", [
    local.docs_reconcile_items_filter,
    "NOT (jsonPayload.kind=\"unmanaged\" OR jsonPayload.kind=\"pending\")",
    "NOT jsonPayload.result=\"done\"",
  ])
}

# --- Log-based metrics --------------------------------------------------------

# Failed requests of the api's own sync (upload, delete, import, list, replace
# rollback and cleanup). A 404 on a delete is logged as ok, so it never counts.
resource "google_logging_metric" "docs_sync_failures" {
  name        = local.docs_sync_failures_metric
  description = "${local.display_name}: failed requests of the api's company-document sync (upload, delete, import, list)."
  filter      = local.docs_sync_failures_filter

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"

    labels {
      key         = "operation"
      value_type  = "STRING"
      description = "gcs.upload, gcs.delete, discoveryengine.import, discoveryengine.delete, discoveryengine.list, replace.rollback or replace.cleanup."
    }

    labels {
      key         = "status"
      value_type  = "STRING"
      description = "HTTP status of the failed request; empty on a timeout or network error."
    }
  }

  label_extractors = {
    operation = "EXTRACT(jsonPayload.operation)"
    status    = "EXTRACT(jsonPayload.status)"
  }

  depends_on = [google_project_service.required]
}

# Every item the reconcile job prints, for dashboards and for finding out what
# a run saw. No alert reads it directly (the next metric does).
resource "google_logging_metric" "docs_reconcile_items" {
  name        = local.docs_reconcile_items_metric
  description = "${local.display_name}: items printed by ${local.docs_reconcile_job_name}, by kind and result."
  filter      = local.docs_reconcile_items_filter

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"

    labels {
      key         = "kind"
      value_type  = "STRING"
      description = "vertex_orphan, vertex_duplicate, gcs_orphan, missing_index, missing_object, retired_entry, pending or unmanaged."
    }

    labels {
      key         = "result"
      value_type  = "STRING"
      description = "planned, done, failed, skipped or reported."
    }
  }

  label_extractors = {
    kind   = "EXTRACT(jsonPayload.kind)"
    result = "EXTRACT(jsonPayload.result)"
  }

  depends_on = [google_project_service.required]
}

# The items that are still drift after their run. The filter, not the alert,
# leaves out unmanaged and pending items, so production's 4 legacy PDFs
# (unmanaged) never count. A second metric rather than a label filter on the
# one above: the exclusion is then plain Logging syntax (NOT, OR), which the
# metric API validates, and a test pins it.
resource "google_logging_metric" "docs_reconcile_unrepaired" {
  name        = local.docs_reconcile_unrepaired_metric
  description = "${local.display_name}: drift items still unrepaired after a run of ${local.docs_reconcile_job_name} (not unmanaged, not pending, not done)."
  filter      = local.docs_reconcile_unrepaired_filter

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"

    labels {
      key         = "kind"
      value_type  = "STRING"
      description = "The kind of drift: vertex_orphan, vertex_duplicate, gcs_orphan, missing_index, missing_object or retired_entry."
    }
  }

  label_extractors = {
    kind = "EXTRACT(jsonPayload.kind)"
  }

  depends_on = [google_project_service.required]
}

# --- Alert policies -----------------------------------------------------------

# P1: a sync request of the api failed. HR saw an error, so a single failure
# alerts. duration 60s, not 0s: the API rejects evaluation_missing_data with a
# zero duration (monitoring.tf), and the 300 s alignment keeps one failure
# visible long enough.
resource "google_monitoring_alert_policy" "docs_sync_failing" {
  display_name          = "${local.display_name}: company document sync failing"
  combiner              = "OR"
  severity              = local.docs_alert_severity
  notification_channels = local.alert_notification_channels
  user_labels           = local.labels

  conditions {
    display_name = "${local.services.api.name} failed a company document request in the last 5 minutes"

    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"cloud_run_revision\"",
        "metric.type = \"logging.googleapis.com/user/${google_logging_metric.docs_sync_failures.name}\"",
      ])

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["metric.label.operation"]
      }

      comparison              = "COMPARISON_GT"
      threshold_value         = 0
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
    subject   = "${local.display_name}: company document sync failing ($${metric.label.operation})"
    content   = <<-EOT
      ${local.services.api.name} logged a failed company document request ($${metric.label.operation}).
      An upload, delete or replace by HR may have left Cloud Storage, Firestore and the search index out of step.
      Read the lines with event onboardai_docs_sync and outcome failed in the service's Cloud Logging, then run
      ${local.docs_reconcile_job_name} (terraform output docs_reconcile_run_command) to see the drift.
    EOT
  }

  depends_on = [google_project_service.required]
}

# P2: an execution of the reconcile job failed (exit 1 to 4: a failed repair, a
# safety stop, an unreadable source, a bad configuration). Cloud Run's own job
# metric, so it also fires when the job dies before it logs anything.
resource "google_monitoring_alert_policy" "docs_reconcile_failed" {
  display_name          = "${local.display_name}: document reconciliation run failed"
  combiner              = "OR"
  severity              = local.docs_alert_severity
  notification_channels = local.alert_notification_channels
  user_labels           = local.labels

  conditions {
    display_name = "${local.docs_reconcile_job_name} had a failed execution"

    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"cloud_run_job\"",
        "resource.label.job_name = \"${google_cloud_run_v2_job.docs_reconcile.name}\"",
        "metric.type = \"run.googleapis.com/job/completed_execution_count\"",
        "metric.label.result = \"failed\"",
      ])

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.job_name"]
      }

      comparison              = "COMPARISON_GT"
      threshold_value         = 0
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
    subject   = "${local.display_name}: document reconciliation run failed"
    content   = <<-EOT
      An execution of ${local.docs_reconcile_job_name} failed. Read its summary line (event onboardai_docs_reconcile,
      fields exitCode and reason) in the job's Cloud Logging: exit 1 an action failed, 2 configuration or
      environment guard, 3 safety stop (nothing changed), 4 a source could not be read.
      See docs/document-reconciliation.md.
    EOT
  }

  depends_on = [google_project_service.required]
}

# P3: no successful execution for 3 h (production) or 6 h (staging), whatever
# the reason: the Scheduler job paused or deleted, the job missing, the API
# disabled. It arms only after the first successful execution, because an
# absence condition needs a series that existed before; run the job once by
# hand after the first apply (README, Document reconciliation). The duration
# must stay under 24 h.
resource "google_monitoring_alert_policy" "docs_reconcile_sla" {
  display_name          = "${local.display_name}: document reconciliation SLA missed (no success in ${trimsuffix(local.docs_reconcile_sla, "s") / 3600} h)"
  combiner              = "OR"
  severity              = local.docs_alert_severity
  notification_channels = local.alert_notification_channels
  user_labels           = local.labels

  conditions {
    display_name = "${local.docs_reconcile_job_name} had no successful execution for ${trimsuffix(local.docs_reconcile_sla, "s") / 3600} hours"

    condition_absent {
      filter = join(" AND ", [
        "resource.type = \"cloud_run_job\"",
        "resource.label.job_name = \"${google_cloud_run_v2_job.docs_reconcile.name}\"",
        "metric.type = \"run.googleapis.com/job/completed_execution_count\"",
        "metric.label.result = \"succeeded\"",
      ])

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.job_name"]
      }

      duration = local.docs_reconcile_sla

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
    subject   = "${local.display_name}: document reconciliation has not succeeded for ${trimsuffix(local.docs_reconcile_sla, "s") / 3600} h"
    content   = <<-EOT
      ${local.docs_reconcile_job_name} should succeed every hour and has not for ${trimsuffix(local.docs_reconcile_sla, "s") / 3600} hours.
      Check the Cloud Scheduler job ${google_cloud_scheduler_job.docs_reconcile.name} (paused, or failing to start the job), the job's executions in Cloud Run, and that
      the Cloud Scheduler API is enabled.
    EOT
  }

  depends_on = [google_project_service.required]
}

# P4: a run reported drift it did not repair: any item that is not unmanaged,
# not pending and not done (the unrepaired metric's filter). The 3900 s (65
# minute) alignment makes consecutive hourly runs overlap, so one open drift is
# one incident instead of a new one each hour; it closes about an hour after
# the last run that still saw drift. In report mode every real drift is
# unrepaired, so this stays open until it is fixed or the job moves to apply.
resource "google_monitoring_alert_policy" "docs_drift_unrepaired" {
  display_name          = "${local.display_name}: document index drift not repaired"
  combiner              = "OR"
  severity              = "WARNING"
  notification_channels = local.alert_notification_channels
  user_labels           = local.labels

  conditions {
    display_name = "${local.docs_reconcile_job_name} reports drift it has not repaired"

    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"cloud_run_job\"",
        "metric.type = \"logging.googleapis.com/user/${google_logging_metric.docs_reconcile_unrepaired.name}\"",
      ])

      aggregations {
        alignment_period     = "3900s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["metric.label.kind"]
      }

      comparison              = "COMPARISON_GT"
      threshold_value         = 0
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
    subject   = "${local.display_name}: document index drift not repaired ($${metric.label.kind})"
    content   = <<-EOT
      ${local.docs_reconcile_job_name} found drift between Firestore, the documents bucket and the search index
      that it has not repaired ($${metric.label.kind}). It is repaired automatically only when the job runs in apply mode
      (mode is ${local.docs_reconcile_mode} now); missing_object and retired_entry need HR.
      Files outside the <uuid>/ folders (unmanaged) and items younger than the grace period (pending) never alert.
      Read the lines with event onboardai_docs_reconcile_item in the job's Cloud Logging.
      See docs/document-reconciliation.md.
    EOT
  }

  depends_on = [google_project_service.required]
}
