# Checks that .github/workflows agree with this module and keep the security
# rules of a public repository with id-token: write. Offline: `terraform test`.

mock_provider "google" {}

variables {
  project_id = "onboardai-test-123"
}

run "deploy_flags_match_terraform" {
  command = plan

  # deploy.yml passes these exact strings to gcloud run deploy; Terraform uses the
  # same locals for the services. If they differ, an apply and a deploy undo
  # each other.
  assert {
    condition = alltrue([
      for key, flags in output.cloud_run_deploy_flags :
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "      ${upper(key)}_RUN_FLAGS: ${flags}\n")
    ])
    error_message = "WEB_/API_/TTS_RUN_FLAGS in .github/workflows/deploy.yml must equal `terraform output cloud_run_deploy_flags`."
  }

  assert {
    condition     = length(regexall("(?m)^\\s+[A-Z]+_RUN_FLAGS:", file("${path.module}/../../.github/workflows/deploy.yml"))) == 3
    error_message = "deploy.yml must define exactly the three *_RUN_FLAGS lines."
  }

  assert {
    condition     = strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "GEMINI_SECRET: ${google_secret_manager_secret.gemini_api_key.secret_id}\n")
    error_message = "deploy.yml must mount the secret Terraform creates."
  }

  assert {
    condition     = strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "--service-account=\"$name-run@$GCP_PROJECT_ID.iam.gserviceaccount.com\"")
    error_message = "deploy.yml must deploy each service as onboardai-<service>-run, the accounts Terraform creates."
  }

  assert {
    condition     = !strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "allow-unauthenticated") && !strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "invoker-iam-check")
    error_message = "Public access is Terraform's (allUsers binding). The deployer cannot set IAM, so the workflow must not try."
  }
}

run "wif_condition_matches_the_deploy_workflow" {
  command = plan

  assert {
    condition     = fileexists("${path.module}/../../.github/workflows/deploy.yml")
    error_message = "The WIF condition trusts .github/workflows/deploy.yml; it must exist."
  }

  # The condition accepts push and workflow_dispatch only; deploy.yml must be
  # triggered by exactly those.
  assert {
    condition     = can(regex("(?s)\non:\n  push:\n    branches: \\[main\\]\n  workflow_dispatch:\n\n", file("${path.module}/../../.github/workflows/deploy.yml")))
    error_message = "deploy.yml must trigger on push to main and workflow_dispatch only."
  }

  assert {
    condition     = alltrue([for f in fileset("${path.module}/../../.github/workflows", "*.{yml,yaml}") : !strcontains(file("${path.module}/../../.github/workflows/${f}"), "pull_request_target")])
    error_message = "pull_request_target must not be used."
  }
}

run "workflows_follow_public_repo_rules" {
  command = plan

  # Every remote action is pinned to a full commit SHA with a version comment.
  assert {
    condition = alltrue(flatten([
      for f in fileset("${path.module}/../../.github/workflows", "*.{yml,yaml}") : [
        for m in regexall("uses:\\s*(\\S+)([^\n]*)", file("${path.module}/../../.github/workflows/${f}")) :
        startswith(m[0], "./") || (can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40}$", m[0])) && can(regex("^ # v[0-9]+\\.[0-9]+\\.[0-9]+$", m[1])))
      ]
    ]))
    error_message = "Pin every action to a 40-character commit SHA followed by '# vX.Y.Z'."
  }

  # id-token: write only on the two jobs that call Google Cloud.
  assert {
    condition     = length(regexall("id-token: write", file("${path.module}/../../.github/workflows/deploy.yml"))) == 2 && !strcontains(file("${path.module}/../../.github/workflows/ci.yml"), "id-token")
    error_message = "id-token: write belongs to the images and deploy jobs of deploy.yml only."
  }

  assert {
    condition     = alltrue([for f in ["ci.yml", "deploy.yml"] : can(regex("(?m)^permissions:\n  contents: read$", file("${path.module}/../../.github/workflows/${f}")))])
    error_message = "Both workflows default to permissions: contents: read."
  }

  # Untrusted event data never reaches a script: the only github.event use is
  # the pull request number in ci.yml's concurrency group.
  assert {
    condition     = !strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "github.event.") && length(regexall("github\\.event\\.", file("${path.module}/../../.github/workflows/ci.yml"))) == 1 && can(regex("(?m)^  group: ci-.*github\\.event\\.pull_request\\.number", file("${path.module}/../../.github/workflows/ci.yml")))
    error_message = "Do not use github.event.* in workflows except the PR number in ci.yml's concurrency group; pass inputs through env."
  }

  assert {
    condition     = length(regexall("persist-credentials: false", file("${path.module}/../../.github/workflows/ci.yml"))) == 2 && length(regexall("persist-credentials: false", file("${path.module}/../../.github/workflows/deploy.yml"))) == 1
    error_message = "Every checkout must set persist-credentials: false."
  }

  # The deploy can only run after CI passed on the same commit.
  assert {
    condition     = strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "uses: ./.github/workflows/ci.yml") && strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "needs: [ci, config]") && strcontains(file("${path.module}/../../.github/workflows/ci.yml"), "workflow_call:")
    error_message = "deploy.yml must call ci.yml and gate the image build on it."
  }

  # Images are built before the auth step writes credentials into the build context.
  assert {
    condition     = can(regex("(?s)name: Build image\n.*name: Authenticate to Google Cloud", file("${path.module}/../../.github/workflows/deploy.yml")))
    error_message = "Build images before google-github-actions/auth runs."
  }

  assert {
    condition     = alltrue([for f in ["ci.yml", "deploy.yml"] : !can(regex("gh pr merge|--auto|git push|auto-merge", file("${path.module}/../../.github/workflows/${f}")))])
    error_message = "Workflows must never merge, push or enable auto-merge."
  }
}
