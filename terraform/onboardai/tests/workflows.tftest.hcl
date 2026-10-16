# Checks that .github/workflows agree with this module and keep the security
# rules of a public repository with id-token: write. Offline: `terraform test`.
# Runs use production (var.environment's default) unless they set staging.

mock_provider "google" {}
mock_provider "google-beta" {}

variables {
  project_id   = "onboardai-test-123"
  alert_emails = ["alerts-a@example.com"]
}

# terraform test runs in whichever workspace is selected; the guard is tested
# on its own in tests/state_guard.tftest.hcl.
override_module {
  target = module.state_guard
}

# Well-formed stand-ins for the apply run below: the provider validates service
# account names, and the config job checks the deployer's email.
override_resource {
  target = google_service_account.deployer
  values = {
    email = "onboardai-deployer@onboardai-test-123.iam.gserviceaccount.com"
    name  = "projects/onboardai-test-123/serviceAccounts/onboardai-deployer@onboardai-test-123.iam.gserviceaccount.com"
  }
}

override_resource {
  target = google_service_account.runtime
  values = {
    email = "onboardai-api-run@onboardai-test-123.iam.gserviceaccount.com"
    name  = "projects/onboardai-test-123/serviceAccounts/onboardai-api-run@onboardai-test-123.iam.gserviceaccount.com"
  }
}

override_resource {
  target = google_iam_workload_identity_pool_provider.github
  values = {
    name = "projects/123456789012/locations/global/workloadIdentityPools/onboardai-github/providers/github-actions"
  }
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

  # Gemini runs on Vertex AI as onboardai-api-run: production mounts no secret,
  # and its api deploy clears any reference an earlier revision carried.
  # Staging (#30) sets exactly two Secret Manager references, DATABASE_URL and
  # INTAKE_MCP_TOKEN, in the branch only a staging deploy takes; --set-secrets
  # replaces every earlier reference too.
  assert {
    condition = (
      !strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "GEMINI_SECRET") &&
      !strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "GEMINI_API_KEY=") &&
      !strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "secret_flags") &&
      !strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "--update-secrets") &&
      length(regexall("--set-secrets", file("${path.module}/../../.github/workflows/deploy.yml"))) == 1 &&
      length(regexall("deploy api ", file("${path.module}/../../.github/workflows/deploy.yml"))) == 2 &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "          else\n            # Production: no secrets at all. --clear-secrets drops any reference\n            # an earlier revision carried (the retired GEMINI_API_KEY mount).\n            deploy api \"$api_env\" --clear-secrets\n          fi\n") &&
      can(regex("          if \\[\\[ \"\\$DEPLOY_ENV\" == staging \\]\\]; then\\n(?:            #[^\\n]*\\n)+            if \\[\\[ ! \"\\$INTAKE_AGENT_ENGINE\" =~ [^\\n]+\\n[^\\n]+\\n[^\\n]+\\n            fi\\n            deploy api \"\\$api_env,INTAKE_AGENT_ENGINE=\\$INTAKE_AGENT_ENGINE\" \\\\\\n              --set-cloudsql-instances=\"\\$GCP_PROJECT_ID:\\$GCP_REGION:onboardai-db\\$NAME_SUFFIX\" \\\\\\n              --set-secrets=\"DATABASE_URL=onboardai-database-url\\$NAME_SUFFIX:latest,INTAKE_MCP_TOKEN=onboardai-intake-mcp-token\\$NAME_SUFFIX:latest\"\\n          else\\n", file("${path.module}/../../.github/workflows/deploy.yml")))
    )
    error_message = "Production deploys the api with --clear-secrets and no secret; only the staging branch (DEPLOY_ENV == staging) sets --set-secrets, with exactly DATABASE_URL and INTAKE_MCP_TOKEN, and the Cloud SQL connection."
  }

  assert {
    condition = (
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "GOOGLE_CLOUD_PROJECT=$GCP_PROJECT_ID,") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "GOOGLE_CLOUD_LOCATION=$VERTEX_LOCATION,") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "\n  VERTEX_LOCATION: global\n")
    )
    error_message = "The api env must carry GOOGLE_CLOUD_PROJECT=$GCP_PROJECT_ID and GOOGLE_CLOUD_LOCATION (VERTEX_LOCATION, global)."
  }

  assert {
    condition = (
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "AI_MODE=$AI_MODE,GEMINI_MODEL=$GEMINI_MODEL,") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), ",VERTEX_SEARCH_LOCATION=$VERTEX_SEARCH_LOCATION,VERTEX_SEARCH_ENGINE_ID=$VERTEX_SEARCH_ENGINE_ID,FIRESTORE_DATABASE_ID=$FIRESTORE_DATABASE_ID,") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "TTS_SERVICE_URL=$tts_url\"")
    )
    error_message = "The api env (contract v2) must carry AI_MODE, GEMINI_MODEL, VERTEX_SEARCH_LOCATION, VERTEX_SEARCH_ENGINE_ID, FIRESTORE_DATABASE_ID and TTS_SERVICE_URL."
  }

  # The deploy job takes the three contract v2 values from the repository
  # variables of the same names.
  assert {
    condition = alltrue([
      for name in ["VERTEX_SEARCH_LOCATION", "VERTEX_SEARCH_ENGINE_ID", "FIRESTORE_DATABASE_ID"] :
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.deploy.env[name] == "$${{ vars.${name} }}" &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.config.env[name] == "$${{ vars.${name} }}"
    ])
    error_message = "deploy and config must read VERTEX_SEARCH_LOCATION, VERTEX_SEARCH_ENGINE_ID and FIRESTORE_DATABASE_ID from vars of the same name."
  }

  assert {
    condition     = alltrue([for f in fileset("${path.module}/../../.github/workflows", "*.{yml,yaml}") : !strcontains(file("${path.module}/../../.github/workflows/${f}"), "GOOGLE_DRIVE_FOLDER_ID")])
    error_message = "GOOGLE_DRIVE_FOLDER_ID is retired; no workflow may mention it."
  }

  # Names the deploy computes, with NAME_SUFFIX empty for production and
  # -staging for staging (deploy_selects_the_stack_by_branch). Terraform's
  # names are checked against them in tests/onboardai.tftest.hcl (production)
  # and tests/staging.tftest.hcl (staging_deploy_names_match_terraform).
  assert {
    condition = (
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "--service-account=\"onboardai-$key-run$NAME_SUFFIX@$GCP_PROJECT_ID.iam.gserviceaccount.com\"") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "name=\"onboardai-$1$NAME_SUFFIX\"") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "--image=\"$REGISTRY/onboardai$NAME_SUFFIX/$key:$GITHUB_SHA\"") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "docker push \"$REGISTRY/onboardai$NAME_SUFFIX/$SERVICE:$GITHUB_SHA\"")
    )
    error_message = "deploy.yml must deploy onboardai-<service>$NAME_SUFFIX as onboardai-<service>-run$NAME_SUFFIX from repository onboardai$NAME_SUFFIX, the names Terraform creates."
  }

  assert {
    condition     = !strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "allow-unauthenticated") && !strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "invoker-iam-check")
    error_message = "Public access is Terraform's (allUsers binding). The deployer cannot set IAM, so the workflow must not try."
  }
}

# Every repository variable a workflow reads has a gh command in the output, and
# every gh command sets a variable a workflow reads. The config job checks each
# one, and every value Terraform knows passes that check.
run "repository_variables_match_terraform" {
  command = apply

  assert {
    condition = toset(flatten([
      for f in fileset("${path.module}/../../.github/workflows", "*.{yml,yaml}") : [
        for m in regexall("vars\\.([A-Za-z0-9_]+)", file("${path.module}/../../.github/workflows/${f}")) : m[0]
      ]
    ])) == toset([for m in regexall("(?m)^gh variable set ([A-Z0-9_]+) ", output.github_variable_commands) : m[0]])
    error_message = "The vars.* the workflows read and the gh variable set commands in output github_variable_commands must be the same set."
  }

  assert {
    condition = alltrue([
      for m in regexall("(?m)^gh variable set ([A-Z0-9_]+) ", output.github_variable_commands) :
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), format("          check %s \"$%s\" ", m[0], m[0]))
    ])
    error_message = "The config job of deploy.yml must check every repository variable."
  }

  assert {
    condition = alltrue([
      for m in regexall("(?m)^gh variable set ([A-Z0-9_]+) --repo [^ ]+ --body '([^']*)'$", output.github_variable_commands) :
      can(regex(regex(format("check %s \"\\$%s\" '([^']+)'", m[0], m[0]), file("${path.module}/../../.github/workflows/deploy.yml"))[0], m[1]))
      if contains(["GCP_PROJECT_ID", "GCP_REGION", "AI_MODE", "GEMINI_MODEL", "VERTEX_SEARCH_LOCATION", "VERTEX_SEARCH_ENGINE_ID", "FIRESTORE_DATABASE_ID"], m[0])
    ])
    error_message = "A value Terraform hands out would fail the config job's check in deploy.yml."
  }
}

run "wif_condition_matches_the_deploy_workflow" {
  command = plan

  assert {
    condition     = fileexists("${path.module}/../../.github/workflows/deploy.yml")
    error_message = "The WIF condition trusts .github/workflows/deploy.yml; it must exist."
  }

  # The conditions accept push and workflow_dispatch only; deploy.yml must be
  # triggered by exactly those, on main (production) and staging (staging).
  assert {
    condition     = can(regex("(?s)\non:\n  push:\n    branches: \\[main, staging\\]\n  workflow_dispatch:\n\n", file("${path.module}/../../.github/workflows/deploy.yml")))
    error_message = "deploy.yml must trigger on push to main or staging and workflow_dispatch only."
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

  # id-token: write only on the three jobs that call Google Cloud: images,
  # agent (staging's intake agent, #30) and deploy.
  assert {
    condition = (
      length(regexall("id-token: write", file("${path.module}/../../.github/workflows/deploy.yml"))) == 3 &&
      toset([for name, job in yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs : name if try(job.permissions["id-token"], "") == "write"]) == toset(["images", "agent", "deploy"]) &&
      !strcontains(file("${path.module}/../../.github/workflows/ci.yml"), "id-token")
    )
    error_message = "id-token: write belongs to the images, agent and deploy jobs of deploy.yml only."
  }

  assert {
    condition     = alltrue([for f in ["ci.yml", "deploy.yml"] : can(regex("(?m)^permissions:\n  contents: read$", file("${path.module}/../../.github/workflows/${f}")))])
    error_message = "Both workflows default to permissions: contents: read."
  }

  # Untrusted input never reaches a script: no run: block contains an
  # expression at all; values arrive through env.
  assert {
    condition = alltrue(flatten([
      for f in ["ci.yml", "deploy.yml"] : [
        for job in values(yamldecode(file("${path.module}/../../.github/workflows/${f}")).jobs) : [
          for step in try(job.steps, []) : !strcontains(try(step.run, ""), "$${{")
        ]
      ]
    ]))
    error_message = "run: scripts must not contain $${{ }} expressions; pass values through env."
  }

  # github.event.* appears only as an env value or in ci.yml's concurrency group.
  assert {
    condition = alltrue(flatten([
      for f in ["ci.yml", "deploy.yml"] : [
        for line in split("\n", file("${path.module}/../../.github/workflows/${f}")) :
        can(regex("^  group: ci-.*github\\.event\\.pull_request\\.number", line)) || can(regex("^\\s+[A-Z][A-Z0-9_]*: \\$\\{\\{ github\\.event\\.[a-z_.]+ \\}\\}$", line))
        if strcontains(line, "github.event.")
      ]
    ]))
    error_message = "Use github.event.* only as an env: value (or the PR number in ci.yml's concurrency group)."
  }

  # Every actions/checkout step sets persist-credentials: false (and there are some).
  assert {
    condition = length(flatten([
      for f in ["ci.yml", "deploy.yml"] : [
        for job in values(yamldecode(file("${path.module}/../../.github/workflows/${f}")).jobs) : [
          for step in try(job.steps, []) : step if startswith(try(step.uses, ""), "actions/checkout@")
        ]
      ]
      ])) > 0 && alltrue(flatten([
      for f in ["ci.yml", "deploy.yml"] : [
        for job in values(yamldecode(file("${path.module}/../../.github/workflows/${f}")).jobs) : [
          for step in try(job.steps, []) : try(step.with["persist-credentials"], null) == false
          if startswith(try(step.uses, ""), "actions/checkout@")
        ]
      ]
    ]))
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

run "ci_skips_docker_builds_only_when_proven" {
  command = plan

  # deploy.yml always builds every image in CI.
  assert {
    condition     = yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.ci.with["run-all"] == true
    error_message = "deploy.yml must call ci.yml with run-all: true."
  }

  # (YAML 1.1 reads the key `on` as true.)
  assert {
    condition = (
      try(yamldecode(file("${path.module}/../../.github/workflows/ci.yml"))["on"], yamldecode(file("${path.module}/../../.github/workflows/ci.yml"))["true"]).workflow_call.inputs["run-all"].type == "boolean" &&
      try(yamldecode(file("${path.module}/../../.github/workflows/ci.yml"))["on"], yamldecode(file("${path.module}/../../.github/workflows/ci.yml"))["true"]).workflow_call.inputs["run-all"].default == false
    )
    error_message = "ci.yml needs a boolean workflow_call input run-all, default false."
  }

  assert {
    condition = (
      yamldecode(file("${path.module}/../../.github/workflows/ci.yml")).jobs.changes.outputs.images == "$${{ steps.detect.outputs.images }}" &&
      one([for s in yamldecode(file("${path.module}/../../.github/workflows/ci.yml")).jobs.changes.steps : s.env.RUN_ALL if try(s.id, "") == "detect"]) == "$${{ inputs.run-all }}"
    )
    error_message = "The changes job must publish images from step detect, which reads inputs.run-all."
  }

  # The list of image inputs: exactly these paths.
  assert {
    condition = toset([
      for p in split(" ", trimspace(replace(replace(regex("(?s)image_inputs=\\(\\s*(.*?)\\s*\\)", one([for s in yamldecode(file("${path.module}/../../.github/workflows/ci.yml")).jobs.changes.steps : s.run if try(s.id, "") == "detect"]))[0], "/\\s+/", " "), "'", ""))) : p
    ]) == toset(["Dockerfile", ".dockerignore", "package.json", "package-lock.json", "index.html", "vite.config.*", "server", "src", "public", "scripts"])
    error_message = "image_inputs must be Dockerfile, .dockerignore, package.json, package-lock.json, index.html, vite.config.*, server, src, public, scripts."
  }

  # Fail safe: exactly one way to answer false, as the script's last line.
  assert {
    condition = (
      length(regexall("decide false", one([for s in yamldecode(file("${path.module}/../../.github/workflows/ci.yml")).jobs.changes.steps : s.run if try(s.id, "") == "detect"]))) == 1 &&
      endswith(trimspace(one([for s in yamldecode(file("${path.module}/../../.github/workflows/ci.yml")).jobs.changes.steps : s.run if try(s.id, "") == "detect"])), "decide false \"no image input changed in $range\"") &&
      strcontains(one([for s in yamldecode(file("${path.module}/../../.github/workflows/ci.yml")).jobs.changes.steps : s.run if try(s.id, "") == "detect"]), "0000000000000000000000000000000000000000")
    )
    error_message = "Detection must answer true on every path except the final proven no-change case (including a zero before SHA)."
  }

  # The three checks keep their names: the matrix job always runs and its steps decide.
  assert {
    condition = (
      yamldecode(file("${path.module}/../../.github/workflows/ci.yml")).jobs.docker.name == "Docker build ($${{ matrix.service }})" &&
      yamldecode(file("${path.module}/../../.github/workflows/ci.yml")).jobs.docker.strategy.matrix.service == ["web", "api", "tts"] &&
      yamldecode(file("${path.module}/../../.github/workflows/ci.yml")).jobs.docker.needs == "changes" &&
      try(yamldecode(file("${path.module}/../../.github/workflows/ci.yml")).jobs.docker.if, "$${{ !cancelled() }}") == "$${{ !cancelled() }}"
    )
    error_message = "Keep 'Docker build (web|api|tts)': gate the build at step level, never with a job-level if that can skip the matrix."
  }

  assert {
    condition = alltrue([
      for s in yamldecode(file("${path.module}/../../.github/workflows/ci.yml")).jobs.docker.steps :
      try(s.if, "") == "needs.changes.outputs.images != 'false'"
      if strcontains(try(s.run, ""), "docker build") || startswith(try(s.uses, ""), "actions/checkout@")
      ]) && length([
      for s in yamldecode(file("${path.module}/../../.github/workflows/ci.yml")).jobs.docker.steps : s
      if strcontains(try(s.run, ""), "docker build") && try(s.if, "") == "needs.changes.outputs.images != 'false'"
    ]) == 1
    error_message = "The checkout and docker build steps must run unless changes.outputs.images is 'false'."
  }

  assert {
    condition = length([
      for s in yamldecode(file("${path.module}/../../.github/workflows/ci.yml")).jobs.docker.steps : s
      if try(s.if, "") == "needs.changes.outputs.images == 'false'" && strcontains(try(s.run, ""), "::notice")
    ]) == 1
    error_message = "One step must print a ::notice when the build is skipped."
  }

  # Verify is unconditional.
  assert {
    condition     = try(yamldecode(file("${path.module}/../../.github/workflows/ci.yml")).jobs.verify.if, null) == null && try(yamldecode(file("${path.module}/../../.github/workflows/ci.yml")).jobs.verify.needs, null) == null && alltrue([for s in yamldecode(file("${path.module}/../../.github/workflows/ci.yml")).jobs.verify.steps : try(s.if, null) == null])
    error_message = "The verify job (format check, tests, build, secret scan) must always run."
  }
}

# ---------------------------------------------------------------------------
# One workflow, two stacks (issue #20)
# ---------------------------------------------------------------------------

# main deploys production, staging deploys staging, nothing else deploys. Every
# job that reads vars.* names the GitHub environment of its stack, so staging
# reads its environment variables and production its repository variables.
run "deploy_selects_the_stack_by_branch" {
  command = plan

  assert {
    condition = (
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.ci.if == "github.ref == 'refs/heads/main' || github.ref == 'refs/heads/staging'" &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.config.if == "github.ref == 'refs/heads/main' || github.ref == 'refs/heads/staging'"
    )
    error_message = "ci and config must run for refs/heads/main and refs/heads/staging only (the refs the two WIF providers trust)."
  }

  assert {
    condition = (
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).env.DEPLOY_ENV == "$${{ github.ref == 'refs/heads/staging' && 'staging' || 'production' }}" &&
      alltrue([for j in ["config", "images", "agent", "deploy"] : yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs[j].environment == "$${{ github.ref == 'refs/heads/staging' && 'staging' || 'production' }}"])
    )
    error_message = "DEPLOY_ENV and the environment of config, images, agent and deploy must all map refs/heads/staging to staging and anything else (main) to production."
  }

  # vars.* in a job without an environment would read production's repository
  # variables during a staging deploy.
  assert {
    condition = alltrue([
      for name, job in yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs :
      try(job.environment, null) == "$${{ github.ref == 'refs/heads/staging' && 'staging' || 'production' }}"
      if strcontains(jsonencode(job), "vars.")
    ]) && !strcontains(jsonencode(yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).env), "vars.")
    error_message = "Every job that reads vars.* must name the stack's environment, and the workflow-level env must not read vars.* at all."
  }

  assert {
    condition = (
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).concurrency.group == "deploy-$${{ github.ref == 'refs/heads/main' && 'production' || github.ref == 'refs/heads/staging' && 'staging' || format('none-{0}', github.run_id) }}" &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).concurrency["cancel-in-progress"] == false
    )
    error_message = "One deploy per environment: group deploy-production for main (unchanged), deploy-staging for staging, a group of its own for any other ref; never cancelled."
  }

  # (YAML 1.1 reads the key `on` as true.)
  assert {
    condition = (
      try(yamldecode(file("${path.module}/../../.github/workflows/ci.yml"))["on"], yamldecode(file("${path.module}/../../.github/workflows/ci.yml"))["true"]).pull_request.branches == ["main", "staging"] &&
      try(yamldecode(file("${path.module}/../../.github/workflows/ci.yml"))["on"], yamldecode(file("${path.module}/../../.github/workflows/ci.yml"))["true"]).push.branches == ["main", "staging"]
    )
    error_message = "ci.yml must run on pull requests into, and pushes to, main and staging."
  }

  # A staging run must never deploy with production's values, nor the other way round.
  assert {
    condition = (
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "          check GCP_DEPLOYER_SA \"$GCP_DEPLOYER_SA\" \"^onboardai-deployer$${NAME_SUFFIX}@$${GCP_PROJECT_ID}\\.iam\\.gserviceaccount\\.com$\"\n") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "          for name in GCP_WIF_PROVIDER VERTEX_SEARCH_ENGINE_ID FIRESTORE_DATABASE_ID; do\n") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "if [[ -n \"$NAME_SUFFIX\" && \"$value\" != *\"$NAME_SUFFIX\" ]] || [[ -z \"$NAME_SUFFIX\" && \"$value\" == *-staging ]]; then")
    )
    error_message = "The config job must check that the deployer, WIF provider, engine and database belong to the stack being deployed."
  }

  assert {
    condition = (
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.smoke.env.GCP_PROJECT_ID == "$${{ needs.deploy.outputs.project_id }}" &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.smoke.env.GCP_REGION == "$${{ needs.deploy.outputs.region }}" &&
      length(regexall("update-traffic onboardai-\\$\\{pair%%=\\*\\}\\$NAME_SUFFIX ", file("${path.module}/../../.github/workflows/deploy.yml"))) == 2
    )
    error_message = "Rollback commands must name the deployed stack's services, project and region."
  }
}

run "staging_deploy_flags_match_terraform" {
  command = plan

  variables {
    environment = "staging"
  }

  assert {
    condition = alltrue([
      for key, flags in output.cloud_run_deploy_flags :
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "      ${upper(key)}_RUN_FLAGS: ${flags}\n")
    ])
    error_message = "Staging's flags differ from deploy.yml's *_RUN_FLAGS, which serve both stacks."
  }
}

run "production_values_pass_the_production_checks" {
  command = apply

  assert {
    condition = alltrue([
      for m in regexall("(?m)^gh variable set ([A-Z0-9_]+) --repo [^ ]+ --body '([^']*)'$", output.github_variable_commands) :
      !endswith(m[1], "-staging") if contains(["GCP_WIF_PROVIDER", "VERTEX_SEARCH_ENGINE_ID", "FIRESTORE_DATABASE_ID"], m[0])
    ]) && google_service_account.deployer.account_id == "onboardai-deployer"
    error_message = "Production's provider, engine and database must not look like staging's, or the config job would refuse the production deploy."
  }
}

# ---------------------------------------------------------------------------
# Employee accounts and the intake agent: staging only (#30)
# ---------------------------------------------------------------------------

# Every #30 step runs on the staging branch only, so a production deploy takes
# exactly the steps it took before. tests/accounts.tftest.hcl checks that the
# names these steps use are the ones Terraform creates.
run "accounts_steps_run_on_staging_only" {
  command = plan

  # The agent job: after every image is pushed, each step but the skip notice
  # gated on the staging branch, and its one output is the engine name.
  assert {
    condition = (
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.agent.needs == "images" &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.agent.outputs == { engine = "$${{ steps.agent.outputs.engine }}" } &&
      length(yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.agent.steps) == 8 &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.agent.steps[0].if == "github.ref != 'refs/heads/staging'" &&
      strcontains(yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.agent.steps[0].run, "::notice") &&
      alltrue([for s in slice(yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.agent.steps, 1, 8) : try(s.if, "") == "github.ref == 'refs/heads/staging'"])
    )
    error_message = "The agent job runs after images, skips with a notice on main, gates every other step on refs/heads/staging, and outputs only the engine name."
  }

  # The deploy job waits for the agent, takes its engine, and migrates before
  # it deploys anything, on staging only.
  assert {
    condition = (
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.deploy.needs == ["images", "agent"] &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.deploy.env.INTAKE_AGENT_ENGINE == "$${{ needs.agent.outputs.engine }}" &&
      [for s in yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.deploy.steps : s.name] == ["Authenticate to Google Cloud", "Set up gcloud", "Record the revisions serving now (rollback targets)", "Migrate the accounts database", "Deploy", "Print rollback commands"] &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.deploy.steps[3].if == "github.ref == 'refs/heads/staging'" &&
      strcontains(yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.deploy.steps[3].run, "gcloud run jobs update \"$job\" --project=\"$GCP_PROJECT_ID\" --region=\"$GCP_REGION\" --image=\"$REGISTRY/onboardai$NAME_SUFFIX/api:$GITHUB_SHA\" --quiet\n") &&
      strcontains(yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.deploy.steps[3].run, "gcloud run jobs execute \"$job\" --project=\"$GCP_PROJECT_ID\" --region=\"$GCP_REGION\" --wait --quiet")
    )
    error_message = "deploy needs [images, agent], reads INTAKE_AGENT_ENGINE from the agent job, and runs the staging-only migration (the api image of this commit, --wait) before the Deploy step."
  }

  # The smoke job's #30 checks run on staging only.
  assert {
    condition = (
      length(yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.smoke.steps) == 3 &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.smoke.steps[1].name == "Check employee accounts and form import" &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.smoke.steps[1].if == "github.ref == 'refs/heads/staging'" &&
      strcontains(yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.smoke.steps[1].run, "'.accounts == true and .employeeImport == true'") &&
      strcontains(yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.smoke.steps[1].run, "\"$API_URL/mcp\"") &&
      strcontains(yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.smoke.steps[1].run, "if [[ \"$code\" == 401 ]]; then")
    )
    error_message = "On staging the smoke test checks /api/config (accounts and employeeImport) and that /mcp refuses a caller without the token (401)."
  }

  # The agent's toolchain never handles credentials: dependencies install
  # without install scripts before the auth step, and the repository is checked
  # out below the workspace root the auth step writes its credentials file to.
  assert {
    condition = (
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.agent.steps[1].with.path == "repo" &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.agent.steps[4].run == "npm ci --omit=dev --ignore-scripts" &&
      startswith(yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.agent.steps[5].uses, "google-github-actions/auth@") &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.agent.steps[3].with["enable-cache"] == false &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.agent.steps[7].id == "agent" &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.agent.steps[7]["working-directory"] == "repo"
    )
    error_message = "The agent job checks out into repo/, installs with --ignore-scripts before authenticating, runs uv without a cache, and deploys from repo/."
  }

  # The deploy command gets the secret's ID, never its value, and its last
  # stdout line must be a reasoning engine in INTAKE_AGENT_LOCATION.
  assert {
    condition = (
      strcontains(yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.agent.steps[7].run, "--mcp-token-secret \"onboardai-intake-mcp-token$NAME_SUFFIX\"") &&
      strcontains(yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.agent.steps[7].run, "--mcp-url \"$api_url/mcp\"") &&
      strcontains(yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.agent.steps[7].run, "engine=$(tail -n 1 \"$log\")") &&
      strcontains(yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.agent.steps[7].run, "/reasoningEngines/[0-9]+$ ]]; then") &&
      !can(regex("(?i)secrets versions access|INTAKE_MCP_TOKEN=[^o]|DATABASE_URL=[^o]", file("${path.module}/../../.github/workflows/deploy.yml")))
    )
    error_message = "The agent deploy passes the token's secret ID only, and the workflow never reads a secret value."
  }
}
