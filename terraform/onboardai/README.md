# OnboardAi on Cloud Run: infrastructure and deploy setup

This Terraform root module builds the OnboardAi MVP in the **OnBoard AI**
project (`project-65a9b676-abdb-4393-bc1`, number `48074397808`, region
`asia-southeast1`) and prepares it for the GitHub Actions deploy in
`.github/workflows/deploy.yml`. It builds two stacks in that project from the
same code: **production** (deployed from `main`, described below) and
**staging** (deployed from `staging`, every ID suffixed `-staging`; see
[Staging](#staging)). Each has its own state in Cloud Storage (see
[State](#state)).

| Creates                                | Name                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| APIs (never disabled on destroy)       | run, artifactregistry, iam, iamcredentials, sts, secretmanager, aiplatform, discoveryengine, firestore, storage, monitoring |
| Artifact Registry Docker repository    | `onboardai` in `asia-southeast1`, keeps the newest 5 versions of each image                                                 |
| Cloud Run services (placeholder image) | `onboardai-web`, `onboardai-api`, `onboardai-tts`, all public (`allUsers` invoker)                                          |
| Runtime service accounts               | `onboardai-web-run`, `onboardai-api-run`, `onboardai-tts-run`                                                               |
| Deployer service account (no key)      | `onboardai-deployer`                                                                                                        |
| Workload Identity Federation           | pool `onboardai-github`, provider `github-actions`                                                                          |
| Project roles of `onboardai-api-run`   | `roles/aiplatform.user`, `roles/discoveryengine.viewer`, `roles/datastore.user`: the only project-level bindings            |
| Documents bucket                       | `<project>-onboardai-docs`: uniform access, public access prevention, versioning                                            |
| Vertex AI Search (`global`)            | data store `onboardai-docs` (layout parser, 500-token chunks), Enterprise engine `onboardai-search`                         |
| Firestore                              | `(default)`, Native mode, `asia-southeast1`, delete protection on                                                           |
| Cloud Monitoring                       | one email channel per `alert_emails` entry; alerts on 5xx (api, tts) and api p95 latency                                    |

**Who owns what.** Terraform owns each service's shape: identity, CPU, memory,
scaling, concurrency, timeout, startup probe, ingress and public access. The
deploy workflow owns the image, the environment variables
and traffic. Both pass the same settings: the workflow's `WEB_RUN_FLAGS`,
`API_RUN_FLAGS` and `TTS_RUN_FLAGS` lines must equal
`terraform output cloud_run_deploy_flags`, and `terraform test` fails if they
differ. To change a setting, edit `locals.tf`, copy the new output into
`deploy.yml`, then apply and deploy.

## Prerequisites

- Terraform 1.9 or newer, the gcloud CLI, and the GitHub CLI (`gh`) logged in
  with admin rights on `UniVRse-Team/univrse-onboardai`.
- Owner on the project (the module sets project IAM and creates the WIF pool,
  Firestore and Discovery Engine resources).
- Bootstrap, done once by hand and already done for OnBoard AI:
  `cloudresourcemanager.googleapis.com` and `serviceusage.googleapis.com`
  enabled, and the state bucket `gs://project-65a9b676-abdb-4393-bc1-tfstate`
  created (asia-southeast1, uniform access, public access prevention,
  versioning).

Do steps 1 to 3 **before** the pull request that changes `deploy.yml` is
merged. The merge pushes to `main`, and that push starts a deploy. Without the
repository variables that deploy stops at its first check.

## State

`versions.tf` keeps the state in `gs://project-65a9b676-abdb-4393-bc1-tfstate`
under the prefix `onboardai`, one object per Terraform workspace:

| Workspace | `environment` | State object                |
| --------- | ------------- | --------------------------- |
| `default` | `production`  | `onboardai/default.tfstate` |
| `staging` | `staging`     | `onboardai/staging.tfstate` |

The GCS backend locks the state during a plan or apply, and bucket versioning
keeps every earlier state. The module does not manage that bucket: a module
must not own the bucket its own state is in. Nothing but `.terraform/` is kept
locally.

A plan fails with `Module output value precondition failed` when the selected
workspace and `environment` disagree (for example staging inputs with the
`default` workspace selected), so neither stack's inputs can be planned against
the other's state. `terraform workspace show` prints the selected one.

## One-time setup

### 1. Create the infrastructure

```sh
cd terraform/onboardai
gcloud auth application-default login     # credentials Terraform uses
# without ADC: export GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token)
cat > terraform.tfvars <<'EOF'            # gitignored; never commit it
project_id   = "project-65a9b676-abdb-4393-bc1"
alert_emails = ["someone@example.com"]
EOF
terraform init        # connects to the GCS backend
terraform plan        # review: everything is "to add"
terraform apply
```

### 2. Upload and import the documents

Upload the onboarding documents (PDF, DOCX, HTML, TXT and similar) to the top
level of the documents bucket, then import them into the data store:

```sh
gcloud storage cp ./company-docs/* "gs://$(terraform output -raw docs_bucket_name)/"
terraform output -raw import_documents_command    # review, then run it
```

The import is a REST call, not Terraform. Discovery Engine reads
`gs://<bucket>/*` as its service agent, which holds `roles/storage.objectViewer`
on that bucket only. `INCREMENTAL` adds new documents and updates changed ones;
it never deletes. The call returns a long-running operation. Poll it with the
same two headers on `https://discoveryengine.googleapis.com/v1/<operation name>`.
Run the import again after every upload. To remove a document, delete it from
the data store as well as from the bucket.

The API searches the serving config in output `vertex_search_serving_config`:
`projects/48074397808/locations/global/collections/default_collection/engines/onboardai-search/servingConfigs/default_search`.
The app shows the file name and section of a result, never a signed URL, and
the API holds no bucket role.

### 3. Set the GitHub repository variables

```sh
terraform output -raw github_variable_commands
```

Review the printed `gh variable set ...` lines, then run them. The workflows
read these variables (none of them is a secret):

| Repository variable       | Source                                                      |
| ------------------------- | ----------------------------------------------------------- |
| `GCP_PROJECT_ID`          | `project_id`                                                |
| `GCP_REGION`              | `region` (default `asia-southeast1`)                        |
| `GCP_WIF_PROVIDER`        | output `workload_identity_provider` (known after apply)     |
| `GCP_DEPLOYER_SA`         | output `deployer_service_account_email` (known after apply) |
| `AI_MODE`                 | `ai_mode` (default `gemini-chat`)                           |
| `GEMINI_MODEL`            | `gemini_model` (default `gemini-3.5-flash-lite`)            |
| `VERTEX_SEARCH_LOCATION`  | the engine's location: `global`                             |
| `VERTEX_SEARCH_ENGINE_ID` | the engine ID: `onboardai-search`                           |
| `FIRESTORE_DATABASE_ID`   | the Firestore database: `(default)`                         |

`terraform test` fails if a workflow reads a variable that has no command here,
or the other way round. To change `AI_MODE` or `GEMINI_MODEL` later, set the
variable in GitHub and run the deploy again. `GOOGLE_DRIVE_FOLDER_ID` is
retired: delete it from the repository variables if it is still set.

### 4. Trigger the first deploy

Merge the pull request (a push to `main` deploys), or run it by hand:

```sh
gh workflow run deploy.yml --repo UniVRse-Team/univrse-onboardai --ref main
gh run watch --repo UniVRse-Team/univrse-onboardai
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

### 5. Check

```sh
terraform output service_urls   # open onboardai-web in a browser
terraform plan                  # expect: No changes
```

The first production plan after the staging change (issue #20) shows one
state-only move and nothing else; see
[Staging: production's one-time state move](#productions-one-time-state-move).

`terraform plan` after a deploy must show no changes. If it plans an update to a
service, the deploy flags and `locals.tf` have drifted apart; fix them before
you apply.

## Gemini, Vertex AI Search and Firestore

The API has no API key. It calls Gemini on Vertex AI, searches
`onboardai-search` and reads and writes Firestore as `onboardai-api-run`, with
Application Default Credentials. The deploy sets `GOOGLE_CLOUD_PROJECT`,
`GOOGLE_CLOUD_LOCATION=global` (`gemini-3.5-flash-lite` answers on `global` and
returns 404 on `asia-southeast1`), `VERTEX_SEARCH_LOCATION`,
`VERTEX_SEARCH_ENGINE_ID` and `FIRESTORE_DATABASE_ID`. It always passes
`--clear-secrets` to the API, which drops the old `GEMINI_API_KEY` secret mount.

The data store's document processing (layout parser; layout-based chunks of at
most 500 tokens that carry their ancestor headings) cannot change after
creation. Different chunking means a new data store and a fresh import.

## Alerts

Cloud Monitoring emails every address in `alert_emails` (one email channel
each) when:

- **5xx responses** (`run.googleapis.com/request_count` with
  `response_code_class = 5xx`) on `onboardai-api` or `onboardai-tts` keep coming
  for 5 minutes: every 1-minute window holds at least one. One incident per
  service. `onboardai-web` is left out because it proxies the API.
- **Latency**: the p95 of `onboardai-api` (`run.googleapis.com/request_latencies`)
  over 5 minutes is above 20 s. A streamed answer counts until the stream ends.

A service scaled to zero sends no data, and missing data never fires an alert;
an open incident closes after 30 minutes without data. Two conditions keep the
alerting cost low. To change the addresses, edit `alert_emails` and apply.

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
- **api**: one instance, because conversations are SQLite on local disk
  (until they move to Firestore). Measured locally: 61 MiB idle (demo mode).
  1Gi leaves room for the SQLite file, which Cloud Run keeps in memory.
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
  the repository ID is `1418194026`, the owner ID is `283518526`, the ref is
  `refs/heads/main`, the workflow is `.github/workflows/deploy.yml` on `main`,
  and the event is `push` or `workflow_dispatch`. Pull requests, forks, other
  branches and other workflows cannot get a token. Staging has its own pool and
  provider with the same rule for `refs/heads/staging`.
- The repository moved to the `UniVRse-Team` organisation. The repository
  ID stays the same but the owner ID changes on transfer. Re-derive both with
  `gh api repos/OWNER/NAME --jq '.id, .owner.id'` and update
  `github_repository`, `github_repository_id` and `github_repository_owner_id`.
- The deploy jobs name a GitHub environment (`production` for `main`, `staging`
  for `staging`), which changes the OIDC token's `sub` claim. Neither provider
  reads `sub`: the conditions use `repository_id`, `repository_owner_id`,
  `ref`, `workflow_ref` and `event_name`, and the deployer binding uses
  `attribute.repository_id`.
- The deployer holds no project-level role. It holds Cloud Run Developer on the
  three OnboardAi services, Artifact Registry Writer on the `onboardai`
  repository, Service Account User on the three runtime accounts, and nothing
  else. It cannot create services, change IAM policies, or touch any other
  Cloud Run service in the project.
- There is no API key and no Secret Manager secret. `onboardai-api-run` holds
  `roles/aiplatform.user`, `roles/discoveryengine.viewer` (includes
  `discoveryengine.servingConfigs.search`) and `roles/datastore.user` on the
  project. Those are the only project-level bindings in this module; the web
  and tts accounts and the deployer hold none. The API has no access to the
  documents bucket.
- The repository is public, so its Actions logs are public too, and they show
  the project ID and the service URLs. Neither is a credential. To hide the
  project ID, make `GCP_PROJECT_ID` a repository secret instead and change
  `vars.GCP_PROJECT_ID` to `secrets.GCP_PROJECT_ID` in `deploy.yml`.

## Tear down

Destroy is blocked on purpose while `deletion_protection` is `true` (the
default):

- The Cloud Run services have `deletion_protection = true`.
- The data store and the engine have `deletion_policy = "PREVENT"`. Deleting
  the data store deletes the imported documents.
- Firestore has delete protection on and `deletion_policy = "ABANDON"`:
  `terraform destroy` only drops it from state, and the data stays.
- The documents bucket is never force-destroyed: empty it first.

To tear a stack down, apply once with `-var deletion_protection=false` (review
the plan: it only lifts those guards), empty the bucket, then destroy. For
staging, see [Staging: tear down](#tear-down-staging).

Destroy leaves the APIs on. A deleted workload identity pool keeps its ID
reserved for 30 days; to recreate it within that time, undelete the pool
instead.

## Staging

A second stack in the same project, built from the same code with
`environment = "staging"`, in its own workspace and state. `main` deploys
production and `staging` deploys staging, through the same
`.github/workflows/deploy.yml`.

| Resource                   | Production                                        | Staging                                                                   |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------- |
| Cloud Run services         | `onboardai-web`, `onboardai-api`, `onboardai-tts` | `onboardai-web-staging`, `onboardai-api-staging`, `onboardai-tts-staging` |
| Runtime service accounts   | `onboardai-<service>-run`                         | `onboardai-<service>-run-staging`                                         |
| Deployer service account   | `onboardai-deployer`                              | `onboardai-deployer-staging`                                              |
| Artifact Registry          | `onboardai`                                       | `onboardai-staging`                                                       |
| WIF pool / provider        | `onboardai-github` / `github-actions`             | `onboardai-github-staging` / `github-actions-staging`                     |
| Documents bucket           | `<project>-onboardai-docs`                        | `<project>-onboardai-docs-staging`                                        |
| Data store / engine        | `onboardai-docs` / `onboardai-search`             | `onboardai-docs-staging` / `onboardai-search-staging`                     |
| Firestore database         | `(default)`                                       | `onboardai-staging` (a project has one `(default)`)                       |
| Alerts                     | `OnboardAi: ...`                                  | `OnboardAi [staging]: ...`, watching the staging services                 |
| Labels                     | `app`, `managed-by`, `component`                  | the same plus `environment = staging`                                     |
| Deploys from / GitHub vars | `main` / repository variables                     | `staging` / variables of the GitHub environment `staging`                 |

Staging has production's shape: the same Cloud Run settings (one set of
`*_RUN_FLAGS` serves both), Enterprise search with the same document
processing, Native-mode Firestore, the same bucket and repository policies, and
the same alerts. API enablement and the Discovery Engine service agent are
project-wide and stay in production's state; staging relies on them and never
manages them.

### Production's one-time state move

Staging skips the Discovery Engine service agent, so that resource now has a
`count`, and a `moved` block in `vertex_ai_search.tf` renames it in
production's state. The first production plan after this change shows only:

```text
# google_project_service_identity.discovery_engine has moved to google_project_service_identity.discovery_engine[0]
Plan: 0 to add, 0 to change, 0 to destroy.
```

Applying that plan rewrites production's state and calls no Google API. After
it, `terraform plan` shows `No changes` again. Until it is applied, every
production plan shows the move (`-detailed-exitcode` returns 2).

### Create the staging stack

```sh
cd terraform/onboardai
export GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token)   # or ADC
cat > staging.tfvars <<'EOF'              # gitignored (*.tfvars); never commit it
environment  = "staging"
project_id   = "project-65a9b676-abdb-4393-bc1"
alert_emails = ["someone@example.com"]
EOF
terraform init
terraform workspace select -or-create staging   # first time: writes an empty onboardai/staging.tfstate
terraform plan -var-file=staging.tfvars -out=staging.tfplan   # review: everything is "to add", every name ends in -staging
terraform apply staging.tfplan
terraform workspace select default              # back to production
```

`terraform.tfvars` (production's inputs) is loaded in every workspace;
`staging.tfvars` overrides it. Forgetting `-var-file=staging.tfvars` in the
`staging` workspace, or passing it in `default`, fails the plan at the
workspace guard before anything is planned.

Then upload documents and import them as in step 2, in the `staging`
workspace: `terraform output -raw docs_bucket_name` and
`terraform output -raw import_documents_command` print the staging bucket and
the staging data store.

### Set up GitHub for staging

In the `staging` workspace:

```sh
terraform output -raw github_environment_commands   # creates environment "staging", deployable from the staging branch only
terraform output -raw github_variable_commands      # gh variable set ... --env staging (all nine variables)
```

Review the printed lines, then run them (gh with admin rights on the
repository). Production's repository variables do not change. The deploy jobs
of a `staging` run read `vars.*` from the `staging` environment, which takes
precedence over the repository variables of the same name.

The first deploy from `main` after this change makes GitHub create an empty
`production` environment, because the deploy jobs now name one. With no
variables of its own it falls back to the repository variables, as before. You
can restrict it to the `main` branch or add reviewers in the repository
settings later.

### Deploy staging

Push to `staging` (merging a pull request into it does that), or run it by
hand:

```sh
gh workflow run deploy.yml --repo UniVRse-Team/univrse-onboardai --ref staging
```

The run checks that the staging deployer, provider, engine and database all
end in `-staging`, pushes to `onboardai-staging`, deploys
`onboardai-<service>-staging` and smoke-tests the staging URLs
(`terraform output service_urls` in the `staging` workspace). Staging and
production deploys never queue behind each other. CI runs on pull requests
into, and pushes to, both branches.

### Isolation inside the shared project

- **Deploy identity.** The staging pool's provider accepts only the deploy
  workflow on `refs/heads/staging` (repository and owner pinned by numeric ID,
  push or workflow_dispatch). `onboardai-deployer-staging` holds Cloud Run
  Developer on the three staging services, Artifact Registry Writer on
  `onboardai-staging` and Service Account User on the three staging runtime
  accounts: nothing on production, and no project-level role.
- **Firestore.** `onboardai-api-run-staging` holds `roles/datastore.user` on the
  project with an IAM condition, `resource.name` equal to
  `projects/<project>/databases/onboardai-staging` (by project ID or number).
  Firestore evaluates database-level IAM conditions, so it cannot read or
  write `(default)`.
- **Vertex AI Search.** `onboardai-api-run-staging` holds no Discovery Engine
  role on the project. It holds `roles/discoveryengine.viewer` on the engine
  `onboardai-search-staging` only (engines carry their own IAM policy), so it
  cannot search `onboardai-search` or read `onboardai-docs`. If engine-level
  grants were not honoured for search, staging search would fail with 403 and
  never reach production's data. Check it once after the first staging deploy
  with a chat that needs the documents.
- **Gemini.** `roles/aiplatform.user` on the project, unconditioned, as in
  production.

After the staging apply, the API's own view of its grants can be checked
without changing anything:

```sh
gcloud projects get-iam-policy project-65a9b676-abdb-4393-bc1 \
  --flatten=bindings --filter="bindings.members:onboardai-api-run-staging@" \
  --format="table(bindings.role, bindings.condition.expression)"
```

### Production follow-ups

Production's grants are wider than staging's and were left unchanged so that
its plan stays empty:

- `onboardai-api-run` holds `roles/datastore.user` and
  `roles/discoveryengine.viewer` on the whole project, unconditioned, so it can
  reach staging's database and search staging's engine. Narrow it the same way
  (a condition on `(default)`, a grant on `onboardai-search`); each is a
  replace of a production IAM binding, so plan and apply it on its own.
- The GitHub environment `production` has no protection rules; consider
  limiting it to `main`.

### Cost of staging

Every staging service scales to zero, so an idle staging stack costs little.
What it adds:

- **Vertex AI Search, Enterprise tier**: per 1,000 search queries, plus index
  storage for the imported documents. Same tier as production for parity; the
  largest variable cost.
- **Firestore named database**: the free tier applies to `(default)` only, so
  every read, write and stored GiB of `onboardai-staging` is billed.
- **Gemini** calls from staging chats, at production's rates.
- **Cloud Run**: request time of staging deploys, smoke tests and use
  (request-based billing, no minimum instances).
- **Artifact Registry**: up to 5 versions of each of the three images
  (`images_to_keep`), roughly as much storage as production's.
- **Cloud Storage**: the staging documents bucket, with 30 days of old
  versions.
- **Cloud Monitoring**: two more alert conditions.

### Tear down staging

In the `staging` workspace:

```sh
terraform apply -var-file=staging.tfvars -var deletion_protection=false   # lifts the guards only; review the plan
gcloud storage rm --all-versions "gs://$(terraform output -raw docs_bucket_name)/**"
terraform destroy -var-file=staging.tfvars -var deletion_protection=false
terraform workspace select default
terraform workspace delete staging          # deletes onboardai/staging.tfstate
```

Destroy deletes the staging database, data store (with its documents) and
engine, and never touches production or the shared APIs. The pool
`onboardai-github-staging` stays reserved for 30 days after deletion. Remove
the GitHub environment `staging` by hand if staging is gone for good.
