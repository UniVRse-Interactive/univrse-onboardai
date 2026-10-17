# Document reconciliation (#79): the Cloud Run job, its trigger account and
# grants, the hourly Cloud Scheduler job, the log-based metrics and the four
# alert policies. `terraform test` in terraform/onboardai, offline (mocked
# providers). Production runs first (var.environment's default), then staging.
#
# Pins the decisions of the issue: the job runs as the api runtime account and
# adds no project-level binding; it starts in report mode in both
# environments; the trigger account holds one grant; nothing in this module
# imports a whole bucket or uses a full reconciliation; every metric and alert
# filter names only its own environment's service or job.

mock_provider "google" {}
mock_provider "google-beta" {}

variables {
  project_id   = "onboardai-test-123"
  alert_emails = ["alerts-a@example.com", "alerts-b@example.com"]
}

# terraform test runs in whichever workspace is selected, so the workspace guard
# is replaced here; tests/state_guard.tftest.hcl tests it directly, and the run
# state_guard_is_wired_to_the_workspace below checks its inputs.
override_module {
  target = module.state_guard
}

override_data {
  target = data.google_project.this
  values = {
    number = "123456789012"
  }
}

# Distinct, well-formed stand-ins (the provider validates service account IDs),
# so a grant that points at the wrong account fails the assertions below.
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
  target = google_iam_workload_identity_pool.github
  values = {
    name = "projects/123456789012/locations/global/workloadIdentityPools/onboardai-github"
  }
}

override_resource {
  target = google_iam_workload_identity_pool_provider.github
  values = {
    name = "projects/123456789012/locations/global/workloadIdentityPools/onboardai-github/providers/github-actions"
  }
}

override_resource {
  target = google_artifact_registry_repository.onboardai
  values = {
    name    = "onboardai"
    project = "onboardai-test-123"
  }
}

# The run.app URL Cloud Run gives web; the uptime checks use its host.
override_resource {
  target = google_cloud_run_v2_service.service["web"]
  values = {
    uri = "https://onboardai-web-abc123xyz-as.a.run.app"
  }
}

# Staging also has the intake agent's account (the staging run below).
override_resource {
  target = google_service_account.intake_agent[0]
  values = {
    email = "onboardai-intake-staging@onboardai-test-123.iam.gserviceaccount.com"
    name  = "projects/onboardai-test-123/serviceAccounts/onboardai-intake-staging@onboardai-test-123.iam.gserviceaccount.com"
  }
}

run "production_job_runs_as_the_api_in_report_mode" {
  command = apply

  assert {
    condition = (
      google_cloud_run_v2_job.docs_reconcile.name == "onboardai-docs-reconcile" &&
      google_cloud_run_v2_job.docs_reconcile.location == "asia-southeast1" &&
      google_cloud_run_v2_job.docs_reconcile.template[0].template[0].service_account == google_service_account.runtime["api"].email &&
      google_cloud_run_v2_job.docs_reconcile.template[0].template[0].service_account != google_service_account.deployer.email &&
      google_cloud_run_v2_job.docs_reconcile.template[0].task_count == 1 &&
      google_cloud_run_v2_job.docs_reconcile.template[0].template[0].timeout == "900s" &&
      google_cloud_run_v2_job.docs_reconcile.template[0].template[0].max_retries == 0 &&
      google_cloud_run_v2_job.docs_reconcile.labels["component"] == "documents" &&
      google_cloud_run_v2_job.docs_reconcile.deletion_protection == true
    )
    error_message = "onboardai-docs-reconcile runs once as the api runtime account (no new identity), 900 s, no retries, deletion-protected."
  }

  # The api image is put in by deploy.yml (and ignored here); no secret, no Cloud SQL.
  assert {
    condition = (
      google_cloud_run_v2_job.docs_reconcile.template[0].template[0].containers[0].image == "us-docker.pkg.dev/cloudrun/container/hello" &&
      alltrue([for e in google_cloud_run_v2_job.docs_reconcile.template[0].template[0].containers[0].env : length(e.value_source) == 0]) &&
      length(google_cloud_run_v2_job.docs_reconcile.template[0].template[0].volumes) == 0 &&
      length(google_cloud_run_v2_job.docs_reconcile.template[0].template[0].containers[0].volume_mounts) == 0 &&
      strcontains(regex("(?s)resource \"google_cloud_run_v2_job\" \"docs_reconcile\" \\{.*?\n\\}\n", file("${path.module}/docs_reconcile.tf")), "template[0].template[0].containers[0].image,")
    )
    error_message = "The job starts from the placeholder image, ignores the image deploy.yml sets, and mounts no secret and no Cloud SQL connection."
  }

  # Report mode: node scripts/reconcile-company-documents.mjs, no --apply.
  assert {
    condition = (
      google_cloud_run_v2_job.docs_reconcile.template[0].template[0].containers[0].command == tolist(["node"]) &&
      google_cloud_run_v2_job.docs_reconcile.template[0].template[0].containers[0].args == tolist(["scripts/reconcile-company-documents.mjs"]) &&
      output.docs_reconcile_mode == "report" &&
      !contains(google_cloud_run_v2_job.docs_reconcile.template[0].template[0].containers[0].args, "--apply")
    )
    error_message = "Report mode runs [node scripts/reconcile-company-documents.mjs] with no --apply (and no --show-names)."
  }

  assert {
    condition = { for e in google_cloud_run_v2_job.docs_reconcile.template[0].template[0].containers[0].env : e.name => e.value } == {
      ONBOARDAI_ENVIRONMENT       = "production"
      GOOGLE_CLOUD_PROJECT        = "onboardai-test-123"
      FIRESTORE_DATABASE_ID       = "(default)"
      DOCS_BUCKET                 = "onboardai-test-123-onboardai-docs"
      VERTEX_SEARCH_DATA_STORE_ID = "onboardai-docs"
      VERTEX_SEARCH_LOCATION      = "global"
    }
    error_message = "The job's environment is exactly this stack's own targets (the script refuses any other mix)."
  }

  assert {
    condition     = alltrue([for k, v in { for e in google_cloud_run_v2_job.docs_reconcile.template[0].template[0].containers[0].env : e.name => e.value } : !strcontains(v, "staging")])
    error_message = "No production reconcile job value may name staging."
  }

  # Trigger account: Scheduler's caller. One grant, on this job; the deployer
  # may update this job only.
  assert {
    condition = (
      google_service_account.docs_reconcile_trigger.account_id == "onboardai-docs-trigger" &&
      length(google_service_account.docs_reconcile_trigger.account_id) <= 30 &&
      google_cloud_run_v2_job_iam_member.trigger_runs_docs_reconcile.role == "roles/run.invoker" &&
      google_cloud_run_v2_job_iam_member.trigger_runs_docs_reconcile.name == google_cloud_run_v2_job.docs_reconcile.name &&
      google_cloud_run_v2_job_iam_member.trigger_runs_docs_reconcile.location == google_cloud_run_v2_job.docs_reconcile.location &&
      google_cloud_run_v2_job_iam_member.trigger_runs_docs_reconcile.member == "serviceAccount:${google_service_account.docs_reconcile_trigger.email}" &&
      google_cloud_run_v2_job_iam_member.deployer_updates_docs_reconcile.role == "roles/run.developer" &&
      google_cloud_run_v2_job_iam_member.deployer_updates_docs_reconcile.name == google_cloud_run_v2_job.docs_reconcile.name &&
      google_cloud_run_v2_job_iam_member.deployer_updates_docs_reconcile.member == "serviceAccount:${google_service_account.deployer.email}"
    )
    error_message = "The trigger account holds roles/run.invoker on the reconcile job; the deployer holds roles/run.developer on it."
  }

  assert {
    condition = (
      sum([for f in fileset(path.module, "*.tf") : length(regexall("member\\s*=\\s*\"serviceAccount:\\$\\{google_service_account\\.docs_reconcile_trigger\\.email\\}\"", file("${path.module}/${f}")))]) == 1 &&
      length(regexall("resource\\s+\"google_cloud_run_v2_job_iam_member\"", file("${path.module}/docs_reconcile.tf"))) == 2 &&
      alltrue([for f in fileset(path.module, "docs_reconcile*.tf") : !can(regex("resource\\s+\"google_(project|folder|organization)_iam|google_service_account_key|google_service_account_iam", file("${path.module}/${f}")))])
    )
    error_message = "The trigger account has one grant (run.invoker on the job), no key, and the job files add no project-level IAM binding and no other IAM."
  }

  # Cloud Scheduler: hourly POST to this job's :run with the trigger account's OAuth token.
  assert {
    condition = (
      google_cloud_scheduler_job.docs_reconcile.name == "onboardai-docs-reconcile" &&
      google_cloud_scheduler_job.docs_reconcile.region == "asia-southeast1" &&
      google_cloud_scheduler_job.docs_reconcile.schedule == "7 * * * *" &&
      google_cloud_scheduler_job.docs_reconcile.time_zone == "Etc/UTC" &&
      google_cloud_scheduler_job.docs_reconcile.attempt_deadline == "60s" &&
      google_cloud_scheduler_job.docs_reconcile.retry_config[0].retry_count == 1 &&
      google_cloud_scheduler_job.docs_reconcile.http_target[0].http_method == "POST" &&
      google_cloud_scheduler_job.docs_reconcile.http_target[0].uri == "https://run.googleapis.com/v2/projects/onboardai-test-123/locations/asia-southeast1/jobs/onboardai-docs-reconcile:run" &&
      google_cloud_scheduler_job.docs_reconcile.http_target[0].oauth_token[0].service_account_email == google_service_account.docs_reconcile_trigger.email &&
      google_cloud_scheduler_job.docs_reconcile.http_target[0].oauth_token[0].scope == "https://www.googleapis.com/auth/cloud-platform" &&
      length(google_cloud_scheduler_job.docs_reconcile.http_target[0].oidc_token) == 0
    )
    error_message = "Cloud Scheduler POSTs onboardai-docs-reconcile:run at 7 * * * * UTC with an OAuth cloud-platform token of the trigger account."
  }

  # Metrics: names end in the stack suffix and each filter names only this stack's service or job.
  assert {
    condition = (
      google_logging_metric.docs_sync_failures.name == "onboardai_docs_sync_failures" &&
      google_logging_metric.docs_reconcile_items.name == "onboardai_docs_reconcile_items" &&
      google_logging_metric.docs_reconcile_unrepaired.name == "onboardai_docs_reconcile_unrepaired" &&
      google_logging_metric.docs_sync_failures.filter == "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"onboardai-api\" AND jsonPayload.event=\"onboardai_docs_sync\" AND jsonPayload.outcome=\"failed\"" &&
      google_logging_metric.docs_reconcile_items.filter == "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"onboardai-docs-reconcile\" AND jsonPayload.event=\"onboardai_docs_reconcile_item\"" &&
      google_logging_metric.docs_reconcile_unrepaired.filter == "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"onboardai-docs-reconcile\" AND jsonPayload.event=\"onboardai_docs_reconcile_item\" AND NOT (jsonPayload.kind=\"unmanaged\" OR jsonPayload.kind=\"pending\") AND NOT jsonPayload.result=\"done\""
    )
    error_message = "Metric names carry the suffix and the filters match the sync and reconcile log contracts for production only."
  }

  assert {
    condition = (
      alltrue([for m in [google_logging_metric.docs_sync_failures, google_logging_metric.docs_reconcile_items, google_logging_metric.docs_reconcile_unrepaired] : m.metric_descriptor[0].metric_kind == "DELTA" && m.metric_descriptor[0].value_type == "INT64"]) &&
      google_logging_metric.docs_sync_failures.label_extractors == tomap({ operation = "EXTRACT(jsonPayload.operation)", status = "EXTRACT(jsonPayload.status)" }) &&
      toset([for l in google_logging_metric.docs_sync_failures.metric_descriptor[0].labels : l.key]) == toset(["operation", "status"]) &&
      google_logging_metric.docs_reconcile_items.label_extractors == tomap({ kind = "EXTRACT(jsonPayload.kind)", result = "EXTRACT(jsonPayload.result)" }) &&
      toset([for l in google_logging_metric.docs_reconcile_items.metric_descriptor[0].labels : l.key]) == toset(["kind", "result"]) &&
      google_logging_metric.docs_reconcile_unrepaired.label_extractors == tomap({ kind = "EXTRACT(jsonPayload.kind)" })
    )
    error_message = "Metrics are DELTA INT64 counters with the operation/status, kind/result and kind labels."
  }

  # Logging precedence: an OR is always inside parentheses.
  assert {
    condition = alltrue([
      for f in [google_logging_metric.docs_sync_failures.filter, google_logging_metric.docs_reconcile_items.filter, google_logging_metric.docs_reconcile_unrepaired.filter] :
      !strcontains(replace(f, "/\\([^)]*\\)/", ""), " OR ")
    ])
    error_message = "Every OR in a metric filter must be inside parentheses (OR binds tighter than AND in Logging queries)."
  }

  # Alerts: existing email channels only, display names, severities, conditions.
  assert {
    condition = alltrue([
      for p in [google_monitoring_alert_policy.docs_sync_failing, google_monitoring_alert_policy.docs_reconcile_failed, google_monitoring_alert_policy.docs_reconcile_sla, google_monitoring_alert_policy.docs_drift_unrepaired] :
      toset(p.notification_channels) == toset([for c in google_monitoring_notification_channel.email : c.name]) && length(p.conditions) == 1
    ])
    error_message = "The four document alerts have one condition each and notify only the existing email channels."
  }

  assert {
    condition = (
      google_monitoring_alert_policy.docs_sync_failing.display_name == "OnboardAi: company document sync failing" &&
      google_monitoring_alert_policy.docs_reconcile_failed.display_name == "OnboardAi: document reconciliation run failed" &&
      google_monitoring_alert_policy.docs_reconcile_sla.display_name == "OnboardAi: document reconciliation SLA missed (no success in 3 h)" &&
      google_monitoring_alert_policy.docs_drift_unrepaired.display_name == "OnboardAi: document index drift not repaired" &&
      google_monitoring_alert_policy.docs_sync_failing.severity == "ERROR" &&
      google_monitoring_alert_policy.docs_reconcile_failed.severity == "ERROR" &&
      google_monitoring_alert_policy.docs_reconcile_sla.severity == "ERROR" &&
      google_monitoring_alert_policy.docs_drift_unrepaired.severity == "WARNING"
    )
    error_message = "Display names follow the OnboardAi pattern; P1 to P3 are ERROR in production, P4 is WARNING."
  }

  assert {
    condition = (
      google_monitoring_alert_policy.docs_sync_failing.conditions[0].condition_threshold[0].filter == "resource.type = \"cloud_run_revision\" AND metric.type = \"logging.googleapis.com/user/onboardai_docs_sync_failures\"" &&
      google_monitoring_alert_policy.docs_sync_failing.conditions[0].condition_threshold[0].aggregations[0].alignment_period == "300s" &&
      google_monitoring_alert_policy.docs_sync_failing.conditions[0].condition_threshold[0].aggregations[0].per_series_aligner == "ALIGN_SUM" &&
      google_monitoring_alert_policy.docs_sync_failing.conditions[0].condition_threshold[0].comparison == "COMPARISON_GT" &&
      google_monitoring_alert_policy.docs_sync_failing.conditions[0].condition_threshold[0].threshold_value == 0 &&
      google_monitoring_alert_policy.docs_sync_failing.conditions[0].condition_threshold[0].duration == "60s" &&
      google_monitoring_alert_policy.docs_sync_failing.conditions[0].condition_threshold[0].evaluation_missing_data == "EVALUATION_MISSING_DATA_INACTIVE" &&
      google_monitoring_alert_policy.docs_reconcile_failed.conditions[0].condition_threshold[0].filter == "resource.type = \"cloud_run_job\" AND resource.label.job_name = \"onboardai-docs-reconcile\" AND metric.type = \"run.googleapis.com/job/completed_execution_count\" AND metric.label.result = \"failed\"" &&
      google_monitoring_alert_policy.docs_reconcile_failed.conditions[0].condition_threshold[0].comparison == "COMPARISON_GT" &&
      google_monitoring_alert_policy.docs_reconcile_failed.conditions[0].condition_threshold[0].threshold_value == 0 &&
      google_monitoring_alert_policy.docs_reconcile_failed.conditions[0].condition_threshold[0].duration == "60s" &&
      google_monitoring_alert_policy.docs_reconcile_failed.conditions[0].condition_threshold[0].evaluation_missing_data == "EVALUATION_MISSING_DATA_INACTIVE"
    )
    error_message = "P1 fires on the sync-failure metric above 0 over 300 s; P2 on a failed execution of onboardai-docs-reconcile; both with duration 60s and missing data inactive."
  }

  # P3: no successful execution within the SLA (3 h). It arms after the first success.
  assert {
    condition = (
      google_monitoring_alert_policy.docs_reconcile_sla.conditions[0].condition_absent[0].filter == "resource.type = \"cloud_run_job\" AND resource.label.job_name = \"onboardai-docs-reconcile\" AND metric.type = \"run.googleapis.com/job/completed_execution_count\" AND metric.label.result = \"succeeded\"" &&
      google_monitoring_alert_policy.docs_reconcile_sla.conditions[0].condition_absent[0].duration == "10800s"
    )
    error_message = "P3 is an absence of a succeeded execution of onboardai-docs-reconcile for 10800s."
  }

  # P4: unrepaired drift only; unmanaged and pending items never reach this metric.
  assert {
    condition = (
      google_monitoring_alert_policy.docs_drift_unrepaired.conditions[0].condition_threshold[0].filter == "resource.type = \"cloud_run_job\" AND metric.type = \"logging.googleapis.com/user/onboardai_docs_reconcile_unrepaired\"" &&
      google_monitoring_alert_policy.docs_drift_unrepaired.conditions[0].condition_threshold[0].aggregations[0].alignment_period == "3900s" &&
      google_monitoring_alert_policy.docs_drift_unrepaired.conditions[0].condition_threshold[0].comparison == "COMPARISON_GT" &&
      google_monitoring_alert_policy.docs_drift_unrepaired.conditions[0].condition_threshold[0].threshold_value == 0 &&
      google_monitoring_alert_policy.docs_drift_unrepaired.conditions[0].condition_threshold[0].duration == "60s" &&
      google_monitoring_alert_policy.docs_drift_unrepaired.conditions[0].condition_threshold[0].evaluation_missing_data == "EVALUATION_MISSING_DATA_INACTIVE" &&
      strcontains(google_logging_metric.docs_reconcile_unrepaired.filter, "NOT (jsonPayload.kind=\"unmanaged\" OR jsonPayload.kind=\"pending\")") &&
      strcontains(google_logging_metric.docs_reconcile_unrepaired.filter, "NOT jsonPayload.result=\"done\"")
    )
    error_message = "P4 fires on the unrepaired-drift metric, aligned over 65 minutes; its metric leaves out unmanaged and pending items and repaired (done) ones."
  }

  # No alert filter names the other stack.
  assert {
    condition = alltrue([
      for f in [
        google_monitoring_alert_policy.docs_sync_failing.conditions[0].condition_threshold[0].filter, google_monitoring_alert_policy.docs_reconcile_failed.conditions[0].condition_threshold[0].filter, google_monitoring_alert_policy.docs_reconcile_sla.conditions[0].condition_absent[0].filter, google_monitoring_alert_policy.docs_drift_unrepaired.conditions[0].condition_threshold[0].filter,
        google_logging_metric.docs_sync_failures.filter, google_logging_metric.docs_reconcile_items.filter, google_logging_metric.docs_reconcile_unrepaired.filter,
      ] : !strcontains(f, "staging")
    ])
    error_message = "No production filter may name staging."
  }
}

run "staging_job_runs_as_the_api_in_report_mode" {
  command = apply

  variables {
    environment = "staging"
  }

  assert {
    condition = (
      google_cloud_run_v2_job.docs_reconcile.name == "onboardai-docs-reconcile-staging" &&
      google_cloud_run_v2_job.docs_reconcile.location == "asia-southeast1" &&
      google_cloud_run_v2_job.docs_reconcile.template[0].template[0].service_account == google_service_account.runtime["api"].email &&
      google_cloud_run_v2_job.docs_reconcile.template[0].template[0].service_account != google_service_account.deployer.email &&
      google_cloud_run_v2_job.docs_reconcile.template[0].task_count == 1 &&
      google_cloud_run_v2_job.docs_reconcile.template[0].template[0].timeout == "900s" &&
      google_cloud_run_v2_job.docs_reconcile.template[0].template[0].max_retries == 0 &&
      google_cloud_run_v2_job.docs_reconcile.labels["component"] == "documents" &&
      google_cloud_run_v2_job.docs_reconcile.deletion_protection == true
    )
    error_message = "onboardai-docs-reconcile-staging runs once as the api runtime account (no new identity), 900 s, no retries, deletion-protected."
  }

  # The api image is put in by deploy.yml (and ignored here); no secret, no Cloud SQL.
  assert {
    condition = (
      google_cloud_run_v2_job.docs_reconcile.template[0].template[0].containers[0].image == "us-docker.pkg.dev/cloudrun/container/hello" &&
      alltrue([for e in google_cloud_run_v2_job.docs_reconcile.template[0].template[0].containers[0].env : length(e.value_source) == 0]) &&
      length(google_cloud_run_v2_job.docs_reconcile.template[0].template[0].volumes) == 0 &&
      length(google_cloud_run_v2_job.docs_reconcile.template[0].template[0].containers[0].volume_mounts) == 0 &&
      strcontains(regex("(?s)resource \"google_cloud_run_v2_job\" \"docs_reconcile\" \\{.*?\n\\}\n", file("${path.module}/docs_reconcile.tf")), "template[0].template[0].containers[0].image,")
    )
    error_message = "The job starts from the placeholder image, ignores the image deploy.yml sets, and mounts no secret and no Cloud SQL connection."
  }

  # Report mode: node scripts/reconcile-company-documents.mjs, no --apply.
  assert {
    condition = (
      google_cloud_run_v2_job.docs_reconcile.template[0].template[0].containers[0].command == tolist(["node"]) &&
      google_cloud_run_v2_job.docs_reconcile.template[0].template[0].containers[0].args == tolist(["scripts/reconcile-company-documents.mjs"]) &&
      output.docs_reconcile_mode == "report" &&
      !contains(google_cloud_run_v2_job.docs_reconcile.template[0].template[0].containers[0].args, "--apply")
    )
    error_message = "Report mode runs [node scripts/reconcile-company-documents.mjs] with no --apply (and no --show-names)."
  }

  assert {
    condition = { for e in google_cloud_run_v2_job.docs_reconcile.template[0].template[0].containers[0].env : e.name => e.value } == {
      ONBOARDAI_ENVIRONMENT       = "staging"
      GOOGLE_CLOUD_PROJECT        = "onboardai-test-123"
      FIRESTORE_DATABASE_ID       = "onboardai-staging"
      DOCS_BUCKET                 = "onboardai-test-123-onboardai-docs-staging"
      VERTEX_SEARCH_DATA_STORE_ID = "onboardai-docs-staging"
      VERTEX_SEARCH_LOCATION      = "global"
    }
    error_message = "The job's environment is exactly this stack's own targets (the script refuses any other mix)."
  }

  # Trigger account: Scheduler's caller. One grant, on this job; the deployer
  # may update this job only.
  assert {
    condition = (
      google_service_account.docs_reconcile_trigger.account_id == "onboardai-docs-trigger-staging" &&
      length(google_service_account.docs_reconcile_trigger.account_id) <= 30 &&
      google_cloud_run_v2_job_iam_member.trigger_runs_docs_reconcile.role == "roles/run.invoker" &&
      google_cloud_run_v2_job_iam_member.trigger_runs_docs_reconcile.name == google_cloud_run_v2_job.docs_reconcile.name &&
      google_cloud_run_v2_job_iam_member.trigger_runs_docs_reconcile.location == google_cloud_run_v2_job.docs_reconcile.location &&
      google_cloud_run_v2_job_iam_member.trigger_runs_docs_reconcile.member == "serviceAccount:${google_service_account.docs_reconcile_trigger.email}" &&
      google_cloud_run_v2_job_iam_member.deployer_updates_docs_reconcile.role == "roles/run.developer" &&
      google_cloud_run_v2_job_iam_member.deployer_updates_docs_reconcile.name == google_cloud_run_v2_job.docs_reconcile.name &&
      google_cloud_run_v2_job_iam_member.deployer_updates_docs_reconcile.member == "serviceAccount:${google_service_account.deployer.email}"
    )
    error_message = "The trigger account holds roles/run.invoker on the reconcile job; the deployer holds roles/run.developer on it."
  }

  assert {
    condition = (
      sum([for f in fileset(path.module, "*.tf") : length(regexall("member\\s*=\\s*\"serviceAccount:\\$\\{google_service_account\\.docs_reconcile_trigger\\.email\\}\"", file("${path.module}/${f}")))]) == 1 &&
      length(regexall("resource\\s+\"google_cloud_run_v2_job_iam_member\"", file("${path.module}/docs_reconcile.tf"))) == 2 &&
      alltrue([for f in fileset(path.module, "docs_reconcile*.tf") : !can(regex("resource\\s+\"google_(project|folder|organization)_iam|google_service_account_key|google_service_account_iam", file("${path.module}/${f}")))])
    )
    error_message = "The trigger account has one grant (run.invoker on the job), no key, and the job files add no project-level IAM binding and no other IAM."
  }

  # Cloud Scheduler: hourly POST to this job's :run with the trigger account's OAuth token.
  assert {
    condition = (
      google_cloud_scheduler_job.docs_reconcile.name == "onboardai-docs-reconcile-staging" &&
      google_cloud_scheduler_job.docs_reconcile.region == "asia-southeast1" &&
      google_cloud_scheduler_job.docs_reconcile.schedule == "37 * * * *" &&
      google_cloud_scheduler_job.docs_reconcile.time_zone == "Etc/UTC" &&
      google_cloud_scheduler_job.docs_reconcile.attempt_deadline == "60s" &&
      google_cloud_scheduler_job.docs_reconcile.retry_config[0].retry_count == 1 &&
      google_cloud_scheduler_job.docs_reconcile.http_target[0].http_method == "POST" &&
      google_cloud_scheduler_job.docs_reconcile.http_target[0].uri == "https://run.googleapis.com/v2/projects/onboardai-test-123/locations/asia-southeast1/jobs/onboardai-docs-reconcile-staging:run" &&
      google_cloud_scheduler_job.docs_reconcile.http_target[0].oauth_token[0].service_account_email == google_service_account.docs_reconcile_trigger.email &&
      google_cloud_scheduler_job.docs_reconcile.http_target[0].oauth_token[0].scope == "https://www.googleapis.com/auth/cloud-platform" &&
      length(google_cloud_scheduler_job.docs_reconcile.http_target[0].oidc_token) == 0
    )
    error_message = "Cloud Scheduler POSTs onboardai-docs-reconcile-staging:run at 37 * * * * UTC with an OAuth cloud-platform token of the trigger account."
  }

  # Metrics: names end in the stack suffix and each filter names only this stack's service or job.
  assert {
    condition = (
      google_logging_metric.docs_sync_failures.name == "onboardai_docs_sync_failures-staging" &&
      google_logging_metric.docs_reconcile_items.name == "onboardai_docs_reconcile_items-staging" &&
      google_logging_metric.docs_reconcile_unrepaired.name == "onboardai_docs_reconcile_unrepaired-staging" &&
      google_logging_metric.docs_sync_failures.filter == "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"onboardai-api-staging\" AND jsonPayload.event=\"onboardai_docs_sync\" AND jsonPayload.outcome=\"failed\"" &&
      google_logging_metric.docs_reconcile_items.filter == "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"onboardai-docs-reconcile-staging\" AND jsonPayload.event=\"onboardai_docs_reconcile_item\"" &&
      google_logging_metric.docs_reconcile_unrepaired.filter == "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"onboardai-docs-reconcile-staging\" AND jsonPayload.event=\"onboardai_docs_reconcile_item\" AND NOT (jsonPayload.kind=\"unmanaged\" OR jsonPayload.kind=\"pending\") AND NOT jsonPayload.result=\"done\""
    )
    error_message = "Metric names carry the suffix and the filters match the sync and reconcile log contracts for staging only."
  }

  assert {
    condition = (
      alltrue([for m in [google_logging_metric.docs_sync_failures, google_logging_metric.docs_reconcile_items, google_logging_metric.docs_reconcile_unrepaired] : m.metric_descriptor[0].metric_kind == "DELTA" && m.metric_descriptor[0].value_type == "INT64"]) &&
      google_logging_metric.docs_sync_failures.label_extractors == tomap({ operation = "EXTRACT(jsonPayload.operation)", status = "EXTRACT(jsonPayload.status)" }) &&
      toset([for l in google_logging_metric.docs_sync_failures.metric_descriptor[0].labels : l.key]) == toset(["operation", "status"]) &&
      google_logging_metric.docs_reconcile_items.label_extractors == tomap({ kind = "EXTRACT(jsonPayload.kind)", result = "EXTRACT(jsonPayload.result)" }) &&
      toset([for l in google_logging_metric.docs_reconcile_items.metric_descriptor[0].labels : l.key]) == toset(["kind", "result"]) &&
      google_logging_metric.docs_reconcile_unrepaired.label_extractors == tomap({ kind = "EXTRACT(jsonPayload.kind)" })
    )
    error_message = "Metrics are DELTA INT64 counters with the operation/status, kind/result and kind labels."
  }

  # Logging precedence: an OR is always inside parentheses.
  assert {
    condition = alltrue([
      for f in [google_logging_metric.docs_sync_failures.filter, google_logging_metric.docs_reconcile_items.filter, google_logging_metric.docs_reconcile_unrepaired.filter] :
      !strcontains(replace(f, "/\\([^)]*\\)/", ""), " OR ")
    ])
    error_message = "Every OR in a metric filter must be inside parentheses (OR binds tighter than AND in Logging queries)."
  }

  # Alerts: existing email channels only, display names, severities, conditions.
  assert {
    condition = alltrue([
      for p in [google_monitoring_alert_policy.docs_sync_failing, google_monitoring_alert_policy.docs_reconcile_failed, google_monitoring_alert_policy.docs_reconcile_sla, google_monitoring_alert_policy.docs_drift_unrepaired] :
      toset(p.notification_channels) == toset([for c in google_monitoring_notification_channel.email : c.name]) && length(p.conditions) == 1
    ])
    error_message = "The four document alerts have one condition each and notify only the existing email channels."
  }

  assert {
    condition = (
      google_monitoring_alert_policy.docs_sync_failing.display_name == "OnboardAi [staging]: company document sync failing" &&
      google_monitoring_alert_policy.docs_reconcile_failed.display_name == "OnboardAi [staging]: document reconciliation run failed" &&
      google_monitoring_alert_policy.docs_reconcile_sla.display_name == "OnboardAi [staging]: document reconciliation SLA missed (no success in 6 h)" &&
      google_monitoring_alert_policy.docs_drift_unrepaired.display_name == "OnboardAi [staging]: document index drift not repaired" &&
      google_monitoring_alert_policy.docs_sync_failing.severity == "WARNING" &&
      google_monitoring_alert_policy.docs_reconcile_failed.severity == "WARNING" &&
      google_monitoring_alert_policy.docs_reconcile_sla.severity == "WARNING" &&
      google_monitoring_alert_policy.docs_drift_unrepaired.severity == "WARNING"
    )
    error_message = "Display names follow the OnboardAi pattern; P1 to P3 are WARNING in staging, P4 is WARNING."
  }

  assert {
    condition = (
      google_monitoring_alert_policy.docs_sync_failing.conditions[0].condition_threshold[0].filter == "resource.type = \"cloud_run_revision\" AND metric.type = \"logging.googleapis.com/user/onboardai_docs_sync_failures-staging\"" &&
      google_monitoring_alert_policy.docs_sync_failing.conditions[0].condition_threshold[0].aggregations[0].alignment_period == "300s" &&
      google_monitoring_alert_policy.docs_sync_failing.conditions[0].condition_threshold[0].aggregations[0].per_series_aligner == "ALIGN_SUM" &&
      google_monitoring_alert_policy.docs_sync_failing.conditions[0].condition_threshold[0].comparison == "COMPARISON_GT" &&
      google_monitoring_alert_policy.docs_sync_failing.conditions[0].condition_threshold[0].threshold_value == 0 &&
      google_monitoring_alert_policy.docs_sync_failing.conditions[0].condition_threshold[0].duration == "60s" &&
      google_monitoring_alert_policy.docs_sync_failing.conditions[0].condition_threshold[0].evaluation_missing_data == "EVALUATION_MISSING_DATA_INACTIVE" &&
      google_monitoring_alert_policy.docs_reconcile_failed.conditions[0].condition_threshold[0].filter == "resource.type = \"cloud_run_job\" AND resource.label.job_name = \"onboardai-docs-reconcile-staging\" AND metric.type = \"run.googleapis.com/job/completed_execution_count\" AND metric.label.result = \"failed\"" &&
      google_monitoring_alert_policy.docs_reconcile_failed.conditions[0].condition_threshold[0].comparison == "COMPARISON_GT" &&
      google_monitoring_alert_policy.docs_reconcile_failed.conditions[0].condition_threshold[0].threshold_value == 0 &&
      google_monitoring_alert_policy.docs_reconcile_failed.conditions[0].condition_threshold[0].duration == "60s" &&
      google_monitoring_alert_policy.docs_reconcile_failed.conditions[0].condition_threshold[0].evaluation_missing_data == "EVALUATION_MISSING_DATA_INACTIVE"
    )
    error_message = "P1 fires on the sync-failure metric above 0 over 300 s; P2 on a failed execution of onboardai-docs-reconcile-staging; both with duration 60s and missing data inactive."
  }

  # P3: no successful execution within the SLA (6 h). It arms after the first success.
  assert {
    condition = (
      google_monitoring_alert_policy.docs_reconcile_sla.conditions[0].condition_absent[0].filter == "resource.type = \"cloud_run_job\" AND resource.label.job_name = \"onboardai-docs-reconcile-staging\" AND metric.type = \"run.googleapis.com/job/completed_execution_count\" AND metric.label.result = \"succeeded\"" &&
      google_monitoring_alert_policy.docs_reconcile_sla.conditions[0].condition_absent[0].duration == "21600s"
    )
    error_message = "P3 is an absence of a succeeded execution of onboardai-docs-reconcile-staging for 21600s."
  }

  # P4: unrepaired drift only; unmanaged and pending items never reach this metric.
  assert {
    condition = (
      google_monitoring_alert_policy.docs_drift_unrepaired.conditions[0].condition_threshold[0].filter == "resource.type = \"cloud_run_job\" AND metric.type = \"logging.googleapis.com/user/onboardai_docs_reconcile_unrepaired-staging\"" &&
      google_monitoring_alert_policy.docs_drift_unrepaired.conditions[0].condition_threshold[0].aggregations[0].alignment_period == "3900s" &&
      google_monitoring_alert_policy.docs_drift_unrepaired.conditions[0].condition_threshold[0].comparison == "COMPARISON_GT" &&
      google_monitoring_alert_policy.docs_drift_unrepaired.conditions[0].condition_threshold[0].threshold_value == 0 &&
      google_monitoring_alert_policy.docs_drift_unrepaired.conditions[0].condition_threshold[0].duration == "60s" &&
      google_monitoring_alert_policy.docs_drift_unrepaired.conditions[0].condition_threshold[0].evaluation_missing_data == "EVALUATION_MISSING_DATA_INACTIVE" &&
      strcontains(google_logging_metric.docs_reconcile_unrepaired.filter, "NOT (jsonPayload.kind=\"unmanaged\" OR jsonPayload.kind=\"pending\")") &&
      strcontains(google_logging_metric.docs_reconcile_unrepaired.filter, "NOT jsonPayload.result=\"done\"")
    )
    error_message = "P4 fires on the unrepaired-drift metric, aligned over 65 minutes; its metric leaves out unmanaged and pending items and repaired (done) ones."
  }

  # No alert filter names the other stack.
  assert {
    condition = alltrue([
      for f in [
        google_monitoring_alert_policy.docs_sync_failing.conditions[0].condition_threshold[0].filter, google_monitoring_alert_policy.docs_reconcile_failed.conditions[0].condition_threshold[0].filter, google_monitoring_alert_policy.docs_reconcile_sla.conditions[0].condition_absent[0].filter, google_monitoring_alert_policy.docs_drift_unrepaired.conditions[0].condition_threshold[0].filter,
        google_logging_metric.docs_sync_failures.filter, google_logging_metric.docs_reconcile_items.filter, google_logging_metric.docs_reconcile_unrepaired.filter,
      ] : strcontains(f, "-staging")
    ])
    error_message = "Staging filters name staging resources."
  }

  assert {
    condition = alltrue([
      for f in [google_logging_metric.docs_sync_failures.filter, google_logging_metric.docs_reconcile_items.filter, google_logging_metric.docs_reconcile_unrepaired.filter] :
      !strcontains(f, "\"onboardai-api\"") && !strcontains(f, "\"onboardai-docs-reconcile\"")
    ])
    error_message = "A staging filter must not match production's service or job."
  }
}

# Both environments start in report mode. Apply mode is a later PR; the map is
# in code so a flip is a reviewed diff, and this pin makes it a deliberate test
# change too. Apply mode adds --apply to the args and nothing else.
run "reconcile_mode_is_pinned_and_wired" {
  command = plan

  assert {
    condition = (
      length(regexall("docs_reconcile_mode = \\{ production = \"report\", staging = \"report\" \\}\\[var\\.environment\\]", file("${path.module}/docs_reconcile.tf"))) == 1 &&
      strcontains(file("${path.module}/docs_reconcile.tf"), "args    = concat([\"scripts/reconcile-company-documents.mjs\"], local.docs_reconcile_mode == \"apply\" ? [\"--apply\"] : [])") &&
      output.docs_reconcile_mode == "report" &&
      alltrue([for f in fileset(path.module, "*.tf") : !strcontains(file("${path.module}/${f}"), "--show-names")])
    )
    error_message = "docs_reconcile_mode must be { production = \"report\", staging = \"report\" }[var.environment]; apply mode adds --apply only; the job never passes --show-names."
  }

  assert {
    condition = (
      toset(["variable"]) == toset(["variable"]) &&
      !can(regex("docs_reconcile_mode", file("${path.module}/variables.tf"))) &&
      alltrue([for f in fileset(path.module, "*.tf") : !can(regex("(?i)slack|pagerduty", file("${path.module}/${f}")))])
    )
    error_message = "The mode is not a variable, and no Slack or PagerDuty channel exists: alerts use the existing email channels only."
  }
}

# The project-level IAM bindings are unchanged by the job (tests/onboardai
# .tftest.hcl pins the same count): it runs as the api account.
run "reconcile_adds_no_project_level_binding" {
  command = plan

  assert {
    condition = (
      sum([for f in fileset(path.module, "*.tf") : length(regexall("resource\\s+\"google_project_iam_", file("${path.module}/${f}")))]) == 4 &&
      length(google_project_iam_member.api_runtime) == 4 &&
      alltrue([for f in fileset(path.module, "*.tf") : !can(regex("roles/(owner|editor|run\\.admin|iam\\.serviceAccountTokenCreator|cloudscheduler\\.)", file("${path.module}/${f}")))])
    )
    error_message = "The reconcile job adds no google_project_iam_* binding (still 4) and no Scheduler, admin or token-creator role."
  }
}

# Nothing under terraform/ can put a whole bucket back into the index, nor
# make the bucket the source of truth.
run "no_bucket_wide_import_or_full_reconciliation" {
  command = plan

  assert {
    condition = alltrue([
      for f in fileset("${path.module}/..", "**/*.{tf,tfvars,hcl,md}") :
      !can(regex("(?i)reconciliationMode[^\\n]{0,40}FULL|\"FULL\"|documents:import|gs://[^\\s\"']*/\\*", file("${path.module}/../${f}"))) || startswith(f, "onboardai/tests/") || startswith(f, ".terraform/") || startswith(f, "onboardai/.terraform/")
    ])
    error_message = "No Terraform file may carry a FULL reconciliation, a documents:import call or a gs://bucket/* URI (D-2: a bucket-wide import resurrects orphans)."
  }

  assert {
    condition     = alltrue([for f in fileset(path.module, "*.tf") : !can(regex("output\\s+\"import_documents_command\"|import_request", file("${path.module}/${f}")))])
    error_message = "The import_documents_command output and its import request are retired."
  }
}

run "scheduler_api_is_enabled_by_production_state_only" {
  command = plan

  assert {
    condition     = contains(keys(google_project_service.required), "cloudscheduler.googleapis.com") && google_project_service.required["cloudscheduler.googleapis.com"].disable_on_destroy == false
    error_message = "Production's state enables cloudscheduler.googleapis.com and never disables it on destroy."
  }
}
