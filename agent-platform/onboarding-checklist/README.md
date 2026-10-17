# Onboarding checklist agent

A Google Agent Development Kit (ADK) agent (#51). When an employee tells Alya that they finished an
onboarding activity ("I've met my buddy", "I signed my contract"), the OnboardAi api hands the
message to this agent. It reads the employee's onboarding template and progress from Firestore,
finds the matching step and proposes marking it with ADK tool confirmation. Nothing changes until
the employee taps **Approve**; the agent then writes the step and names the next one. The whole
flow, the api contract and the privacy choices are in
[docs/onboarding-journey.md](../../docs/onboarding-journey.md#checklist-agent-51).

## Layout

| Path                                       | Purpose                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `onboarding_checklist/__init__.py`         | Imports `agent`, as `adk api_server` expects                                                   |
| `onboarding_checklist/agent.py`            | `root_agent`: an `LlmAgent` on Gemini (explicit project and location) with the two tools       |
| `onboarding_checklist/tools.py`            | `get_onboarding_progress()` and `mark_step(step_id)` (tool confirmation)                       |
| `onboarding_checklist/rules.py`            | The footprint rules, identical to the api's `server/onboarding-progress.mjs`                   |
| `onboarding_checklist/store.py`            | Firestore reads and the one transactional write                                                |
| `onboarding_checklist/config.py`           | Settings from the environment; fails with one clear message                                    |
| `onboarding_checklist/instruction.py`      | The instruction (no `{placeholders}`: the session state holds the account id)                  |
| `onboarding_checklist/agent_engine_app.py` | The Agent Engine entrypoint: `app = AdkApp(agent=root_agent)` (never imported locally)         |
| `deploy_agent_engine.py`                   | `npm run checklist-agent:deploy`: create or update the agent on Vertex AI Agent Engine         |
| `tests/`                                   | pytest with an in-memory Firestore and a scripted model (no network, no credentials)           |
| `pyproject.toml`, `uv.lock`                | Python 3.13, `google-adk==2.12.0`, `google-cloud-firestore`; group `deploy`: the Vertex AI SDK |

## Tools and rules

- The employee's account id and track come **only** from the session state the api sets when it
  creates the session (`onboardai_account_id`, `onboardai_track`). No tool takes an account id,
  track or status from the model: `mark_step` takes a step id only.
- `get_onboarding_progress()` reads `onboardingTemplates/{track}` and
  `onboardingProgress/{accountId}`. It returns every step with its status and `briefing_needed`,
  the area progress, whether onboarding is complete (every area at 70% of its required steps) and
  the next step.
- `mark_step(step_id)` needs the employee's confirmation for every step of the template that is
  not a scenario check and does not still need Alya's briefing (`require_confirmation` with a
  predicate on the template and the progress; a briefing is never taken back, so it is the same
  when the run resumes). Then:
  - a `self` or optional step becomes **done**;
  - an `hr_verify` step becomes **submitted** (HR still verifies it);
  - a `check` step is never marked: the agent points to the scenario check on the dashboard;
  - a required step without Alya's briefing (contract v1.5) is never marked. The agent says
    "Before I mark it, please listen to Alya's briefing for <step> on your dashboard." The store
    checks `briefedAt` again inside the write transaction;
  - a step already done, or already submitted, is left as it is.
- The write is one Firestore transaction on `onboardingProgress/{accountId}` with exactly the
  contract's shape: `{ accountId, updatedAt, steps: { [stepId]: { status, updatedAt,
source: "alya-agent", actorId: accountId, briefedAt?, briefedBy? } } }`. The step's briefing
  fields are kept.
- No step matches, or the message could mean several: the agent asks which step, and proposes
  nothing.

## Settings

| Variable                    | Value                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `GOOGLE_GENAI_USE_VERTEXAI` | `TRUE` (anything else is refused: no API keys)                                                |
| `GOOGLE_CLOUD_PROJECT`      | The project for Gemini, unless `CHECKLIST_GEMINI_PROJECT` is set                              |
| `GOOGLE_CLOUD_LOCATION`     | Gemini's location, default `global`, unless `CHECKLIST_GEMINI_LOCATION` is set                |
| `CHECKLIST_AGENT_MODEL`     | Default `gemini-3.8-flash`                                                                    |
| `CHECKLIST_AGENT_THINKING`  | `default` (default) or `low` (thinkingLevel LOW). Output is capped at 1,024 tokens either way |
| `FIRESTORE_PROJECT_ID`      | Default: Gemini's project                                                                     |
| `FIRESTORE_DATABASE_ID`     | Default `(default)`                                                                           |
| `FIRESTORE_EMULATOR_HOST`   | Local only (`npm run checklist-agent` requires it)                                            |
| `CHECKLIST_GEMINI_*`        | Set by the deploy: Agent Engine reserves `GOOGLE_CLOUD_*` for its own project/region          |

## Run locally

From the repository root, with the settings in `.env`, the Firestore emulator running and
`gcloud auth application-default login` done:

```bash
npm run checklist-agent        # ADK API server on 127.0.0.1:${CHECKLIST_AGENT_PORT:-8093}
npm run checklist-agent:test   # uv run pytest (no network, no Gemini)
```

Then start the api with `CHECKLIST_AGENT_URL=http://127.0.0.1:8093`. The ADK server keeps
sessions in memory only (a session holds the employee's message; the api deletes it once the change
is decided or expired), logs at warning level, keeps message content out of its trace spans and
allows at most 8 model calls per run. It has no authentication: keep it on `127.0.0.1`. In a
container: `uv run adk api_server --host 0.0.0.0 --port 8093 .` from this directory.

`uv run pytest` runs every test, including the deploy command and the Agent Engine entrypoint
(the `deploy` group is a default group).

## Deploy to Vertex AI Agent Engine

Deployment is the DevOps workflow's job (`checklist_agent` in `.github/workflows/deploy.yml`):

```bash
npm run --silent checklist-agent:deploy -- --project <id> --location <region> \
  --display-name "OnboardAi onboarding checklist (<env>)" \
  --service-account onboardai-checklist<suffix>@<project>.iam.gserviceaccount.com \
  --firestore-database <id> [--model gemini-3.8-flash] [--gemini-location global]
```

It is idempotent by display name (two instances with the name stop it), deploys this package from
source with a requirements file exported from `uv.lock`, exposes only `async_create_session`,
`async_stream_query`, `async_delete_session` and `async_list_sessions` (to delete an employee's
sessions with the employee), and prints the resource name
`projects/…/locations/…/reasoningEngines/…` as the last line of standard output. The runtime
service account needs `roles/aiplatform.user` and `roles/datastore.user` on that database.
