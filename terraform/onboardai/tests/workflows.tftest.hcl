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

  # Gemini runs on Vertex AI as onboardai-api-run: no secret is ever mounted,
  # and the api always clears any reference an earlier revision carried.
  assert {
    condition = (
      !strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "--set-secrets") &&
      !strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "GEMINI_SECRET") &&
      !strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "GEMINI_API_KEY=") &&
      !strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "secret_flags") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "          deploy api \"$api_env\" --clear-secrets\n")
    )
    error_message = "deploy.yml must never use --set-secrets, and must always deploy the api with --clear-secrets."
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
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "TTS_SERVICE_URL=$tts_url\"") &&
      strcontains(file("${path.module}/../../.github/workflows/deploy.yml"), "GOOGLE_DRIVE_FOLDER_ID=$GOOGLE_DRIVE_FOLDER_ID")
    )
    error_message = "The api env must keep AI_MODE, GEMINI_MODEL, TTS_SERVICE_URL and the optional GOOGLE_DRIVE_FOLDER_ID."
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

run "stale_deploy_guard" {
  command = plan

  # A re-run of an old Deploy run must not overwrite production: the deploy job
  # checks the commit is still the tip of main right before gcloud run deploy.
  assert {
    condition = (
      length([for s in yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.deploy.steps : s if try(s.id, "") == "tip"]) == 1 &&
      one([for s in yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.deploy.steps : s.env.GH_TOKEN if try(s.id, "") == "tip"]) == "$${{ github.token }}" &&
      strcontains(one([for s in yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.deploy.steps : s.run if try(s.id, "") == "tip"]), "commits/main") &&
      strcontains(one([for s in yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.deploy.steps : s.run if try(s.id, "") == "tip"]), "::warning::") &&
      strcontains(one([for s in yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.deploy.steps : s.run if try(s.id, "") == "tip"]), "$GITHUB_SHA") &&
      strcontains(one([for s in yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.deploy.steps : s.run if try(s.id, "") == "tip"]), "exit 1")
    )
    error_message = "The deploy job needs a step with id 'tip' that reads the tip of main with GITHUB_TOKEN, warns with the SHAs, and fails closed."
  }

  # The guard is the step directly before Deploy, so nothing slow runs between them.
  assert {
    condition = (
      index([for s in yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.deploy.steps : try(s.id, "")], "tip") + 1 ==
      index([for s in yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.deploy.steps : try(s.id, "")], "deploy")
    )
    error_message = "The tip-of-main check must be the step immediately before the Deploy step."
  }

  # Deploy and smoke test are gated on the guard.
  assert {
    condition = (
      one([for s in yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.deploy.steps : s.if if try(s.id, "") == "deploy"]) == "steps.tip.outputs.is_tip == 'true'" &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.deploy.outputs.is_tip == "$${{ steps.tip.outputs.is_tip }}" &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.smoke.if == "needs.deploy.outputs.is_tip == 'true'" &&
      yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.smoke.needs == "deploy"
    )
    error_message = "Deploy step and smoke job must run only when the tip check says is_tip == 'true'."
  }

  # No other step may run gcloud run deploy.
  assert {
    condition = length([
      for s in yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.deploy.steps : s
      if strcontains(try(s.run, ""), "gcloud run deploy") && try(s.id, "") != "deploy"
    ]) == 0
    error_message = "Only the gated Deploy step may run gcloud run deploy."
  }

  assert {
    condition     = yamldecode(file("${path.module}/../../.github/workflows/deploy.yml")).jobs.deploy.permissions == { contents = "read", "id-token" = "write" }
    error_message = "The deploy job needs only contents: read (tip lookup) and id-token: write."
  }
}
