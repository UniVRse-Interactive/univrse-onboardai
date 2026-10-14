# Offline checks of the OnboardAi stack: `terraform test` in terraform/onboardai.
# The google provider is mocked, so nothing is read from or created in GCP.
# `command = apply` against the mock fills computed values (emails, resource
# names) with stand-ins, so references between resources can be compared.

mock_provider "google" {}

variables {
  project_id = "onboardai-test-123"
}

# Distinct, well-formed stand-ins (the provider validates service account IDs),
# so a grant that points at the wrong account fails the assertions below.
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

run "wif_trusts_only_main_of_this_repository" {
  command = apply

  assert {
    condition     = strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "assertion.repository_id == '1418194026'")
    error_message = "The WIF condition must pin the numeric repository_id, not only the repository name."
  }

  assert {
    condition     = strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "assertion.ref == 'refs/heads/main'")
    error_message = "The WIF condition must only accept tokens for refs/heads/main."
  }

  assert {
    condition     = strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "assertion.repository_owner_id == '281514177'")
    error_message = "The WIF condition must pin the numeric owner ID."
  }

  assert {
    condition     = strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "assertion.workflow_ref == 'UniVRse-Interactive/univrse-onboardai/.github/workflows/deploy.yml@refs/heads/main'")
    error_message = "The WIF condition must only accept the deploy workflow."
  }

  assert {
    condition     = !strcontains(google_iam_workload_identity_pool_provider.github.attribute_condition, "assertion.sub")
    error_message = "The WIF condition must not depend on the sub claim (a GitHub environment changes it)."
  }

  assert {
    condition     = !can(regex("\\|\\|\\s*assertion\\.(repository|ref)", google_iam_workload_identity_pool_provider.github.attribute_condition))
    error_message = "repository and ref checks must be AND-ed, never OR-ed."
  }

  assert {
    condition     = google_iam_workload_identity_pool_provider.github.oidc[0].issuer_uri == "https://token.actions.githubusercontent.com"
    error_message = "The provider must trust GitHub's OIDC issuer."
  }

  assert {
    condition     = google_iam_workload_identity_pool_provider.github.attribute_mapping["attribute.repository_id"] == "assertion.repository_id"
    error_message = "attribute.repository_id must be mapped; the deployer binding relies on it."
  }

  assert {
    condition     = google_service_account_iam_member.deployer_federation.member == "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository_id/1418194026"
    error_message = "Only principals of this repository ID may impersonate the deployer."
  }

  assert {
    condition     = google_service_account_iam_member.deployer_federation.role == "roles/iam.workloadIdentityUser" && google_service_account_iam_member.deployer_federation.service_account_id == google_service_account.deployer.name
    error_message = "The federation binding must grant workloadIdentityUser on the deployer only."
  }
}

run "deployer_holds_only_resource_level_roles" {
  command = apply

  assert {
    condition     = alltrue([for f in fileset(path.module, "*.tf") : !can(regex("resource\\s+\"google_(project|folder|organization)_iam_", file("${path.module}/${f}")))])
    error_message = "No project-, folder- or organization-level IAM: every grant must be on a single resource."
  }

  assert {
    condition     = alltrue([for f in fileset(path.module, "*.tf") : !can(regex("roles/(owner|editor|viewer|run\\.admin|iam\\.serviceAccountTokenCreator|iam\\.serviceAccountAdmin|resourcemanager\\.)", file("${path.module}/${f}")))])
    error_message = "Basic roles, Cloud Run Admin, token-creator and admin roles must not appear in this module."
  }

  assert {
    condition     = google_service_account.deployer.account_id == "onboardai-deployer"
    error_message = "Deployer account ID is fixed by the service contract."
  }

  assert {
    condition = alltrue([
      for key, m in google_cloud_run_v2_service_iam_member.deployer :
      m.role == "roles/run.developer" && m.member == "serviceAccount:${google_service_account.deployer.email}" && m.name == google_cloud_run_v2_service.service[key].name
    ]) && length(google_cloud_run_v2_service_iam_member.deployer) == 3
    error_message = "The deployer must hold Cloud Run Developer on exactly the three OnboardAi services."
  }

  assert {
    condition     = google_artifact_registry_repository_iam_member.deployer_pushes_images.role == "roles/artifactregistry.writer" && google_artifact_registry_repository_iam_member.deployer_pushes_images.repository == google_artifact_registry_repository.onboardai.name && google_artifact_registry_repository_iam_member.deployer_pushes_images.member == "serviceAccount:${google_service_account.deployer.email}"
    error_message = "The deployer may write to the onboardai repository only."
  }

  assert {
    condition = alltrue([
      for key, m in google_service_account_iam_member.deployer_acts_as_runtime :
      m.role == "roles/iam.serviceAccountUser" && m.service_account_id == google_service_account.runtime[key].name && m.member == "serviceAccount:${google_service_account.deployer.email}"
    ]) && length(google_service_account_iam_member.deployer_acts_as_runtime) == 3
    error_message = "The deployer may act as the three runtime accounts only."
  }
}

run "only_api_runtime_reads_the_gemini_key" {
  command = apply

  assert {
    condition     = google_secret_manager_secret.gemini_api_key.secret_id == "onboardai-gemini-api-key"
    error_message = "Secret name is fixed by the service contract."
  }

  assert {
    condition     = google_secret_manager_secret_iam_member.api_reads_gemini_key.member == "serviceAccount:${google_service_account.runtime["api"].email}" && google_secret_manager_secret_iam_member.api_reads_gemini_key.role == "roles/secretmanager.secretAccessor"
    error_message = "onboardai-api-run must be the secret accessor."
  }

  assert {
    condition     = sum([for f in fileset(path.module, "*.tf") : length(regexall("resource\\s+\"google_secret_manager_secret_iam_", file("${path.module}/${f}")))]) == 1
    error_message = "Exactly one secret IAM grant may exist (api-run reads the Gemini key)."
  }

  assert {
    condition     = alltrue([for f in fileset(path.module, "*.tf") : !can(regex("google_secret_manager_secret_version", file("${path.module}/${f}")))])
    error_message = "Secret values never go in Terraform; the user adds the version with gcloud."
  }
}

run "cloud_run_matches_service_contract" {
  command = apply

  assert {
    condition     = { for k, s in google_cloud_run_v2_service.service : k => s.name } == { web = "onboardai-web", api = "onboardai-api", tts = "onboardai-tts" }
    error_message = "Service names are fixed by the service contract."
  }

  assert {
    condition     = alltrue([for s in google_cloud_run_v2_service.service : s.location == "asia-southeast1" && s.ingress == "INGRESS_TRAFFIC_ALL"])
    error_message = "All services run in asia-southeast1 with public ingress."
  }

  assert {
    condition     = google_cloud_run_v2_service.service["api"].template[0].scaling[0].max_instance_count == 1
    error_message = "onboardai-api must be capped at one instance (SQLite on local disk)."
  }

  assert {
    condition     = alltrue([for s in google_cloud_run_v2_service.service : s.template[0].scaling[0].max_instance_count >= 1 && s.template[0].scaling[0].max_instance_count <= 3 && s.template[0].scaling[0].min_instance_count == 0])
    error_message = "Every service needs a max-instances cost cap (at most 3) and scales to zero."
  }

  assert {
    condition     = alltrue([for k, s in google_cloud_run_v2_service.service : s.template[0].service_account == google_service_account.runtime[k].email && google_service_account.runtime[k].account_id == "onboardai-${k}-run"])
    error_message = "Each service runs as its own onboardai-<service>-run account."
  }

  assert {
    condition     = alltrue([for s in google_cloud_run_v2_service.service : s.template[0].containers[0].ports[0].container_port == 8080])
    error_message = "Containers listen on 8080 (the contract's $PORT)."
  }

  assert {
    condition = (
      google_cloud_run_v2_service.service["web"].template[0].containers[0].startup_probe[0].http_get[0].path == "/web-health" &&
      google_cloud_run_v2_service.service["api"].template[0].containers[0].startup_probe[0].http_get[0].path == "/api/health" &&
      google_cloud_run_v2_service.service["tts"].template[0].containers[0].startup_probe[0].http_get[0].path == "/health"
    )
    error_message = "Startup probes must use the contract's health paths."
  }

  assert {
    condition     = alltrue([for s in google_cloud_run_v2_service.service : !endswith(s.template[0].containers[0].startup_probe[0].http_get[0].path, "z")])
    error_message = "The contract forbids health paths ending in z (reserved on Cloud Run)."
  }

  assert {
    condition     = google_cloud_run_v2_service.service["tts"].template[0].containers[0].resources[0].limits.memory == "2Gi"
    error_message = "tts needs 2Gi for Kokoro (measured peak about 1 GiB; 1.1 GiB was OOM-killed)."
  }

  assert {
    condition     = length(google_cloud_run_v2_service_iam_member.public_invoker) == 3 && alltrue([for m in google_cloud_run_v2_service_iam_member.public_invoker : m.member == "allUsers" && m.role == "roles/run.invoker"])
    error_message = "All three services are public (user decision for the demo)."
  }

  assert {
    condition     = output.artifact_registry_image_prefix == "asia-southeast1-docker.pkg.dev/${google_artifact_registry_repository.onboardai.project}/onboardai" && google_artifact_registry_repository.onboardai.format == "DOCKER"
    error_message = "Images live in the onboardai Docker repository in the region."
  }

  assert {
    condition     = length(google_artifact_registry_repository.onboardai.cleanup_policies) == 2 && google_artifact_registry_repository.onboardai.cleanup_policy_dry_run == false
    error_message = "The repository needs its keep/delete cleanup policies, not in dry-run."
  }

  assert {
    condition     = alltrue([for api in ["run.googleapis.com", "artifactregistry.googleapis.com", "iam.googleapis.com", "iamcredentials.googleapis.com", "sts.googleapis.com", "secretmanager.googleapis.com"] : contains(keys(google_project_service.required), api) && google_project_service.required[api].disable_on_destroy == false])
    error_message = "Required APIs must be managed and never disabled on destroy."
  }
}

run "outputs_carry_the_setup_commands" {
  command = apply

  assert {
    condition     = output.gemini_api_key_add_command == "gcloud secrets versions add onboardai-gemini-api-key --project=onboardai-test-123 --data-file=-"
    error_message = "The secret command must read the value from stdin."
  }

  assert {
    condition = alltrue([
      for name in ["GCP_PROJECT_ID", "GCP_REGION", "GCP_WIF_PROVIDER", "GCP_DEPLOYER_SA", "AI_MODE", "GEMINI_MODEL"] :
      strcontains(output.github_variable_commands, "gh variable set ${name} --repo UniVRse-Interactive/univrse-onboardai --body '")
    ])
    error_message = "Every repository variable deploy.yml reads needs a gh command."
  }

  assert {
    condition     = strcontains(output.github_variable_commands, "--body '${google_iam_workload_identity_pool_provider.github.name}'") && strcontains(output.github_variable_commands, "--body '${google_service_account.deployer.email}'")
    error_message = "GCP_WIF_PROVIDER and GCP_DEPLOYER_SA must come from the resources."
  }

  assert {
    condition     = strcontains(output.github_variable_commands, "# GOOGLE_DRIVE_FOLDER_ID")
    error_message = "Without a folder ID the output must say how to set it."
  }
}

run "drive_folder_command_when_set" {
  command = plan

  variables {
    google_drive_folder_id = "1AbC_dEf-123"
  }

  assert {
    condition     = strcontains(output.github_variable_commands, "gh variable set GOOGLE_DRIVE_FOLDER_ID --repo UniVRse-Interactive/univrse-onboardai --body '1AbC_dEf-123'")
    error_message = "A set folder ID must produce its gh command."
  }
}

run "rejects_repository_name_as_id" {
  command = plan

  variables {
    github_repository_id = "UniVRse-Interactive/univrse-onboardai"
  }

  expect_failures = [var.github_repository_id]
}

run "rejects_unknown_ai_mode" {
  command = plan

  variables {
    ai_mode = "gemini-chat,EXTRA=1"
  }

  expect_failures = [var.ai_mode]
}
