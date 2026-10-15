# OnboardAi on Cloud Run: infrastructure and deploy setup

This Terraform root module builds the OnboardAi MVP in the **OnBoard AI**
project (`project-65a9b676-abdb-4393-bc1`, number `48074397808`, region
`asia-southeast1`) and prepares it for the GitHub Actions deploy in
`.github/workflows/deploy.yml`. It is the only stack in that project; its state
is in Cloud Storage (see [State](#state)).

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
  with admin rights on `UniVRse-Interactive/univrse-onboardai`.
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
under the prefix `onboardai`. The GCS backend locks the state during a plan or
apply, and bucket versioning keeps every earlier state. The module does not
manage that bucket: a module must not own the bucket its own state is in.
Nothing but `.terraform/` is kept locally.

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

### 5. Check

```sh
terraform output service_urls   # open onboardai-web in a browser
terraform plan                  # expect: No changes
```

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
  the repository ID is `1418194026`, the owner ID is `281514177`, the ref is
  `refs/heads/main`, the workflow is `.github/workflows/deploy.yml` on `main`,
  and the event is `push` or `workflow_dispatch`. Pull requests, forks, other
  branches and other workflows cannot get a token.
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

Destroy is blocked on purpose:

- The Cloud Run services have `deletion_protection = true`. Set it to `false`
  in `cloud_run.tf` and apply first.
- The data store and the engine have `deletion_policy = "PREVENT"`. Set it to
  `"DELETE"` in `vertex_ai_search.tf` and apply first. Deleting the data store
  deletes the imported documents.
- Firestore has delete protection on and `deletion_policy = "ABANDON"`:
  `terraform destroy` only drops it from state, and the data stays.
- The documents bucket is not force-destroyed: empty it first.

Destroy leaves the APIs on. A deleted workload identity pool keeps its ID
reserved for 30 days; to recreate it within that time, undelete the pool
instead.
