# OnboardAi on Cloud Run: infrastructure and deploy setup

This Terraform root module prepares Google Cloud for the GitHub Actions deploy in
`.github/workflows/deploy.yml`. It is separate from the FinOps digest stack in
`terraform/` (own state, own labels `app = "onboardai"`), although both live in
the same project.

| Creates                                | Name                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| APIs (never disabled on destroy)       | run, artifactregistry, iam, iamcredentials, sts, secretmanager, drive              |
| Artifact Registry Docker repository    | `onboardai` in `asia-southeast1`, keeps the newest 5 versions of each image        |
| Cloud Run services (placeholder image) | `onboardai-web`, `onboardai-api`, `onboardai-tts`, all public (`allUsers` invoker) |
| Runtime service accounts               | `onboardai-web-run`, `onboardai-api-run`, `onboardai-tts-run`                      |
| Deployer service account (no key)      | `onboardai-deployer`                                                               |
| Workload Identity Federation           | pool `onboardai-github`, provider `github-actions`                                 |
| Secret Manager secret (container only) | `onboardai-gemini-api-key`, readable only by `onboardai-api-run`                   |

**Who owns what.** Terraform owns each service's shape: identity, CPU, memory,
scaling, concurrency, timeout, startup probe, ingress and public access. The
deploy workflow owns the image, the environment variables, the secret reference
and traffic. Both pass the same settings: the workflow's `WEB_RUN_FLAGS`,
`API_RUN_FLAGS` and `TTS_RUN_FLAGS` lines must equal
`terraform output cloud_run_deploy_flags`, and `terraform test` fails if they
differ. To change a setting, edit `locals.tf`, copy the new output into
`deploy.yml`, then apply and deploy.

## Prerequisites

- Terraform 1.9 or newer, the gcloud CLI, and the GitHub CLI (`gh`) logged in
  with admin rights on `UniVRse-Interactive/univrse-onboardai`.
- Owner (or equivalent IAM, IAM Workload Identity Pool, Cloud Run, Artifact
  Registry and Secret Manager admin roles) on the project.
- `cloudresourcemanager.googleapis.com` and `serviceusage.googleapis.com` enabled
  (the FinOps stack already did this in the shared project).

Do steps 1 to 4 **before** the pull request that adds `deploy.yml` is merged.
The merge pushes to `main`, and that push starts a deploy. Without the
repository variables that deploy stops at its first check.

## One-time setup

### 1. Create the infrastructure

```sh
cd terraform/onboardai
gcloud auth application-default login     # credentials Terraform uses
cat > terraform.tfvars <<'EOF'            # gitignored; never commit it
project_id             = "YOUR_PROJECT_ID"
google_drive_folder_id = "YOUR_DRIVE_FOLDER_ID"  # optional
EOF
terraform init
terraform plan        # review: everything is "to add"
terraform apply
```

State is local (`terraform.tfstate` here, gitignored). Keep it safe, and
move it to a GCS backend before anyone else applies this module.

### 2. Add the Gemini API key

```sh
terraform output -raw gemini_api_key_add_command
```

Run the printed `gcloud secrets versions add ... --data-file=-` command, paste
the key, press Enter, then Ctrl-D. The key never enters the shell history,
Terraform state or this repository. The API service receives it as the
environment variable `GEMINI_API_KEY`, from version `latest`. To rotate the key,
add a new version and redeploy.

### 3. Share the Google Drive folder

```sh
terraform output -raw api_runtime_service_account_email
```

In Google Drive, share the company documents folder with that address as
**Viewer**. Skip this when `AI_MODE` does not use Drive.

### 4. Set the GitHub repository variables

```sh
terraform output -raw github_variable_commands
```

Review the printed `gh variable set ...` lines, then run them. The workflows
read these variables (none of them is a secret):

| Repository variable      | Source                                                        |
| ------------------------ | ------------------------------------------------------------- |
| `GCP_PROJECT_ID`         | `project_id`                                                  |
| `GCP_REGION`             | `region` (default `asia-southeast1`)                          |
| `GCP_WIF_PROVIDER`       | output `workload_identity_provider`                           |
| `GCP_DEPLOYER_SA`        | output `deployer_service_account_email`                       |
| `AI_MODE`                | `ai_mode` (default `gemini-chat`)                             |
| `GEMINI_MODEL`           | `gemini_model` (default `gemini-3.5-flash-lite`)              |
| `GOOGLE_DRIVE_FOLDER_ID` | `google_drive_folder_id` (optional; empty means sample tasks) |

To change `AI_MODE`, `GEMINI_MODEL` or `GOOGLE_DRIVE_FOLDER_ID` later, set the
variable in GitHub and run the deploy again.

### 5. Trigger the first deploy

Merge the pull request (a push to `main` deploys), or run it by hand:

```sh
gh workflow run deploy.yml --repo UniVRse-Interactive/univrse-onboardai --ref main
gh run watch --repo UniVRse-Interactive/univrse-onboardai
```

The workflow runs CI on the commit, builds and pushes the three images tagged
with the commit SHA, deploys tts, then api, then web, and smoke-tests
`/health`, `/api/health`, `/web-health`, `/api/health` through the web proxy,
and `/`.

**CI on pull requests and pushes.** `Verify` (format check, tests, build and
the secret scan) always runs. The three `Docker build (web|api|tts)` checks
always report, but they build only when the change touches an image input:
`Dockerfile`, `.dockerignore`, `package.json`, `package-lock.json`,
`index.html`, `vite.config.*`, `server/`, `src/`, `public/` or `scripts/`.
Otherwise they pass with a notice that the build was skipped. Pull requests
compare against the merge base with the base branch; pushes compare with the
previous tip. When the comparison is impossible (a new branch, a force push, a
missing commit), the images are built. The deploy always builds all three, in
CI and for the push.

### 6. Check

```sh
terraform output service_urls   # open onboardai-web in a browser
terraform plan                  # expect: No changes
```

`terraform plan` after a deploy must show no changes. If it plans an update to a
service, the deploy flags and `locals.tf` have drifted apart; fix them before
you apply.

## Roll back

A failed deploy or smoke test prints the exact commands in the job log and the
run summary. They send each service back to the revision that served before
that run. By hand:

```sh
gcloud run revisions list --service=onboardai-web --region=asia-southeast1 --project=YOUR_PROJECT_ID
gcloud run services update-traffic onboardai-web --region=asia-southeast1 --project=YOUR_PROJECT_ID \
  --to-revisions=REVISION_NAME=100
```

Repeat for `onboardai-api` and `onboardai-tts` as needed. The URLs do not
change. A rollback lasts until the next deploy: each deploy sends traffic back
to the newest revision. To keep the old behaviour, revert the commit on `main`,
which deploys the reverted code. You can roll back only to revisions whose
images are among the newest 5 per image (`images_to_keep`).

## Cloud Run settings

|                     | web                    | api                    | tts                 |
| ------------------- | ---------------------- | ---------------------- | ------------------- |
| CPU / memory        | 1 / 512Mi              | 1 / 1Gi                | 2 / 2Gi             |
| Concurrency         | 80                     | 80                     | 8                   |
| Min / max instances | 0 / 3                  | 0 / 1 (contract)       | 0 / 2               |
| Request timeout     | 300 s                  | 300 s                  | 300 s               |
| Startup probe       | `GET /web-health` 60 s | `GET /api/health` 60 s | `GET /health` 240 s |
| Startup CPU boost   | off                    | on                     | on                  |

All three use the gen2 execution environment, request-based billing (CPU only
while serving), scale to zero, and listen on port 8080.

- **web**: static files and a streaming proxy. Measured locally: 21 MiB idle,
  53 MiB peak. 512Mi is the gen2 minimum. The 300 s timeout is above the proxy's
  290 s upstream timeout, so the proxy answers a slow API with its own 504.
- **api**: one instance, because conversations are SQLite on local disk.
  Measured locally: 61 MiB idle (demo mode). 1Gi leaves room for the Drive
  document cache and the SQLite file, which Cloud Run keeps in memory.
- **tts**: Kokoro q8 (82M) runs a whole answer, up to the model's 512 tokens, in
  one ONNX pass. Measured on linux/arm64 (container cgroup peak): 340 MiB after
  the model loads in about 0.6 s; 508 MiB for 100 characters, 591 for 150, 652
  for 200, 685 for 225. Natively, the longest input peaks at 727 MiB and reaches
  1022 MiB after repeated renders. A container capped at 1100 MiB was OOM-killed
  on its second 225-character render. 2Gi is therefore the smallest standard
  size with headroom. Renders run one at a time, so memory does not grow with
  concurrency. Two cores rendered 17% faster than one (15.9 s against 19.1 s for
  225 characters). The app answers `VOICE_BUSY` beyond 8 queued requests, so
  concurrency is 8. The 240 s startup probe covers the model load; `/health`
  returns 503 until then.

These are local measurements, not Cloud Run figures. After the first deploys,
check memory utilisation in the Cloud Run console. Raise tts to 4Gi if its logs
show "Memory limit exceeded".

## Security

- GitHub Actions has no key. The provider accepts a GitHub OIDC token only when
  the repository ID is `1418194026`, the owner ID is `281514177`, the ref is
  `refs/heads/main`, the workflow is `.github/workflows/deploy.yml` on `main`,
  and the event is `push` or `workflow_dispatch`. Pull requests, forks, other
  branches and other workflows cannot get a token.
- The deployer holds no project-level role. It holds Cloud Run Developer on the
  three OnboardAi services, Artifact Registry Writer on the `onboardai`
  repository, Service Account User on the three runtime accounts, and nothing
  else. It cannot create services, change IAM policies, or touch any other
  Cloud Run service in the project.
- Only `onboardai-api-run` can read the Gemini key. The web and tts accounts
  hold no roles.
- The repository is public, so its Actions logs are public too, and they show
  the project ID and the service URLs. Neither is a credential. To hide the
  project ID, make `GCP_PROJECT_ID` a repository secret instead and change
  `vars.GCP_PROJECT_ID` to `secrets.GCP_PROJECT_ID` in `deploy.yml`.

## Tear down

The services and the secret have `deletion_protection = true`. Set both to
`false`, run `terraform apply`, then run `terraform destroy`. Destroy leaves the
APIs on. A deleted workload identity pool keeps its ID reserved for 30 days;
to recreate it within that time, undelete the pool instead.
