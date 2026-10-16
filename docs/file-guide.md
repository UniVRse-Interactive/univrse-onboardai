# Developer file guide

The project stays in JavaScript and React. `.jsx` files contain React screens; `.js` and `.mjs` contain JavaScript; `.css` files control appearance. `.mjs` makes the server's module format explicit.

## Main folders

| Folder                 | What it contains                                                              |
| ---------------------- | ----------------------------------------------------------------------------- |
| `src/portal/`          | The website shell and the welcome, onboarding and support pages               |
| `src/avatar/`          | Alya's chat screen, avatar rendering, answer visuals and support summary      |
| `src/access/`          | Employee/HR login interface, employee sign-up and live guest HR workspace     |
| `server/`              | API routes, accounts, Gemini workflow, document search, saved chats and voice |
| `scripts/`             | Development, connection checks, avatar import and voice setup                 |
| `tests/`               | Regression checks using temporary data and synthetic company documents        |
| `public/avatars/alya/` | The original avatar, loading poster and asset information                     |
| `docs/`                | Architecture and behaviour explanations                                       |

`node_modules`, `dist`, `.cache` and `artifacts` are generated or private working folders. They are excluded from sharing. `.env` holds this installation's private settings; `.env.example` is the blank setup template.

## Start reading here

1. `src/main.jsx` starts React and redirects old page addresses.
2. `src/portal/OnboardingWebsite.jsx` selects a page and renders the website shell.
3. `src/avatar/AlyaChatPage.jsx` submits questions and displays chat, the avatar, visual answers and support controls.
4. `server/index.mjs` starts the HTTP server and serves the website and compressed avatar.
5. `server/api-routes.mjs` handles browser requests and calls the appropriate chat or voice service.

## Website

`src/styles/theme.css` defines the shared navy (`#0A2D43`), gold (`#F6C44B`) and
ivory palette. `src/brand/OnboardAiBrand.jsx` draws the shared sailboat mark and
OnboardAi wordmark. Existing browser storage keys keep their original names so
saved preferences survive the branding change.

| File                                           | Purpose                                                |
| ---------------------------------------------- | ------------------------------------------------------ |
| `src/portal/OnboardingWebsite.jsx`             | Page layouts, navigation, checklist and personal notes |
| `src/portal/website-content.js`                | Navigation labels, suggested tasks and support roles   |
| `src/portal/website.css`                       | Website colours, spacing and responsive layouts        |
| `src/portal/DecorativeWebsiteIllustration.jsx` | Decorative SVG artwork for website pages               |
| `src/portal/Icon.jsx`                          | Shared labelled interface icons                        |

## Chat and company knowledge

| File                                    | Purpose                                                         |
| --------------------------------------- | --------------------------------------------------------------- |
| `server/api-routes.mjs`                 | Chat, saved-chat, settings, support-summary and voice endpoints |
| `server/gemini-chat-workflow.mjs`       | LangGraph conversation steps and Gemini prompts/answers         |
| `server/vertex-ai-search.mjs`           | Vertex AI Search chunk search, passages, file names and errors  |
| `server/company-document-retriever.mjs` | Chooses Vertex AI Search or the sample guide for passages       |
| `server/document-search.mjs`            | Search-only preview that quotes passages without Gemini         |
| `server/chat-store.mjs`                 | Chooses Firestore or SQLite for saved chats                     |
| `server/firestore-chat-memory.mjs`      | Firestore saved chats, support data, turn leases and expiry     |
| `server/firestore-checkpointer.mjs`     | LangGraph checkpoints in Firestore                              |
| `server/firestore-client.mjs`           | Firestore client, time limit and safe storage errors            |
| `server/chat-errors.mjs`                | Chat and storage error messages shared by both stores           |
| `server/saved-conversations.mjs`        | SQLite history, ownership checks, expiry and deletion (local)   |
| `server/answer-style-preferences.mjs`   | Explanation preference and explicit support requests            |
| `server/sample-onboarding-content.mjs`  | Sample/demo answers, separate from real company documents       |
| `src/avatar/AnswerStyleSettings.jsx`    | The five explanation choices and their visible reason           |

For Gemini chat, the main path is:

```text
Question + saved context
    -> interpret the question
    -> search approved company documents (Vertex AI Search)
    -> write an answer with references
    -> save the conversation
    -> display text, visual explanation and voice
```

LangChain connects the model. Vertex AI Search returns the company passages. LangGraph runs and checkpoints the conversation steps. Neither library diagnoses employees or replaces the language model.

The guide uses `src/avatar/use-visual-text-pages.js` to measure available paragraph space and `src/avatar/visual-text-pagination.mjs` to paginate without dropping words. The question form is visible only in Chat; Next/Back replaces scrolling inside the guide.

## Avatar and voice

| File                                         | Purpose                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `src/avatar/AvatarDisplay.jsx`               | Avatar loading, presence and poster fallback                             |
| `src/avatar/avatar-renderer.js`              | Three.js camera, light, model, face and gentle movement                  |
| `src/avatar/answer-audio-player.js`          | Fetch server audio, play it and cancel safely                            |
| `src/avatar/speech-text-and-mouth-timing.js` | Prepare spoken text and estimate English mouth timing                    |
| `src/avatar/alya-chat.css`                   | Chat/avatar layout and chat controls                                     |
| `src/avatar/alya-workspace.css`              | Window-sized chat and visual panes with a visible avatar                 |
| `server/kokoro-voice.mjs`                    | Fixed Kokoro Heart voice, startup warmup, synthesis queue and WAV output |
| `scripts/download-voice-model.mjs`           | Cache the voice model and create a sample                                |
| `scripts/import-avatar-model.mjs`            | Import and compress a revised original GLB                               |

The browser plays WAV audio from `/api/voice`, starting with a short opening while the next segment is prepared. The installed model warms at server startup. Mouth movement follows the audio clock using estimated phonemes. The unused browser-voice controller was removed; text and mouth-timing helpers remain because the current player uses them.

`server/optional-windows-voice.mjs`, `server/windows-audio-mouth-timing.mjs`, `scripts/start-windows-voice-helper.ps1` and `scripts/WindowsVoiceHelper.cs` support the existing optional Windows TTS route. They are retained because the server still calls them. The current website's shared voice uses Kokoro.

## Visual answers and HR summary

| File                                     | Purpose                                                         |
| ---------------------------------------- | --------------------------------------------------------------- |
| `src/avatar/VisualAnswerPanel.jsx`       | Separate visual workspace and answer selection                  |
| `src/avatar/IllustratedAnswer.jsx`       | Numbered illustration sections and full-answer reading dialog   |
| `src/avatar/AnswerIllustrations.jsx`     | Original SVG subject illustrations                              |
| `src/avatar/visual-answer-content.mjs`   | Build a visual explanation from the delivered answer            |
| `src/avatar/visual-answer.css`           | Visual-panel styling and keyboard focus                         |
| `src/access/HrWorkspace.jsx`             | Live individual reports, team counts and automatic summaries    |
| `src/access/CompanyDocumentLibrary.jsx`  | Company uploads, file removal and company-source status         |
| `src/access/hr-report-insights.mjs`      | Aggregate activity counts and explicit support labels           |
| `src/avatar/hr-support-report.mjs`       | The concise report text exported for HR                         |
| `src/avatar/answer-support-controls.css` | Feedback, explanation and source controls                       |
| `server/employee-support-tracking.mjs`   | Recorded support requests, feedback and summary templates       |
| `server/answer-guide-metadata.mjs`       | Source-supported guide metadata for existing saved-chat records |

The persisted/API field named `card` remains compatible with existing chats and guide counts. It is metadata; the interface uses the separate visual panel. UI component renames do not rename database fields, cookies or local preference keys.

## Useful script names

- `start-development-server.mjs`: start Node with file watching and Vite live updates.
- `check-gemini-connection.mjs`: check Gemini with one small live request.
- `check-vertex-ai-search.mjs`: check Vertex AI Search with one live search (`npm run check:search`).
- `import-company-documents.mjs`: upload a folder to the documents bucket and import it into Vertex AI Search (`npm run docs:import`, dry run by default).
- `check-shareable-files.mjs`: inspect the Git file list without printing secrets or publishing files.
- `migrate-database.mjs`: apply the SQL and Firestore migrations (`npm run db:migrate`).
- `check-migration-files.mjs`: list the migration files and fail on a misnamed or duplicate one (`npm run db:migrations:check`).
- `create-hr-account.mjs`: create an HR account (`npm run hr:create`).
- `reset-hr-password.mjs`: recover an HR account (`npm run hr:reset-password`).
- `local-stack.mjs`: start, reset, stop and log the local Docker stack (`npm run local`, `local:reset-hr`, `local:down`, `local:logs`).

Use the `npm` commands in the README rather than remembering these file paths.

## What was cleaned up

Ambiguous names such as `Portal`, `AvatarStage`, `conversation` and `drive-knowledge` were replaced with names that describe their role. The architecture notes are grouped in `docs/`. Compressed source formatting is expanded consistently with Prettier. Tests and imports follow the new names.

The existing removed pages and old standalone avatar demos stay removed. The unused device-voice controller and its obsolete tests were replaced with checks for the active audio player. The original avatar, live settings, saved conversations and voice cache are preserved.

## Cloud Run services

In the cloud the website runs as three services (web, api, tts); see [Cloud Run services](cloud-run-services.md).

| File                         | Purpose                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `server/web-service.mjs`     | Starts the web service                                                           |
| `server/web-app.mjs`         | Serves `dist/` and the avatar, and mounts the `/api` proxy                       |
| `server/api-proxy.mjs`       | Forwards `/api/*` to the api service and streams the answer back                 |
| `server/api-service.mjs`     | Starts the api service (the routes in `server/api-routes.mjs`)                   |
| `server/tts-service.mjs`     | Starts the tts service (`server/tts-app.mjs`, Kokoro)                            |
| `server/remote-voice.mjs`    | The api's client for the tts service                                             |
| `server/service-auth.mjs`    | `SERVICE_AUTH` and the Google ID tokens the private api and tts services require |
| `server/service-runtime.mjs` | `.env` loading, `TRUST_PROXY` and clean shutdown shared by the three entry files |

## Accounts

HR and employee sign-in, on when `DATABASE_URL` is set. PostgreSQL holds accounts, sessions and the audit trail; Firestore holds employee profiles, account-owned chats and the company knowledge library. See [Account access](account-access.md) for the setup, rules and API contract.

| File                                    | Purpose                                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `server/account-settings.mjs`           | When accounts are on, and the start-up guard (Firestore emulator off Cloud Run)                                               |
| `server/account-service.mjs`            | Sign-in, sessions, lockout, password changes and HR actions; `createEmployeeAccount`, the one way employees are created       |
| `server/account-store.mjs`              | PostgreSQL pool, queries and transactions (Employee ID allocation too); code-only error logs                                  |
| `server/account-routes.mjs`             | `/api/auth`, `/api/me` and `/api/hr` routes and the `onboardai_account` cookie                                                |
| `server/account-errors.mjs`             | Account error codes and messages                                                                                              |
| `server/password-hashing.mjs`           | scrypt password hashes, password rules and generated passwords (temporary and local HR)                                       |
| `server/departments.mjs`                | The six first departments and prefixes, seed data only (migration 004 holds the live list in `departments`); import-free      |
| `server/employee-ids.mjs`               | The prefix rule (2–4 letters, `HR` reserved) and the `PE-0001` Employee ID format                                             |
| `server/employee-profiles.mjs`          | Profile validation and `employeeProfiles/{accountId}` in Firestore; removes an account's profile and `employeeImports` drafts |
| `server/company-knowledge.mjs`          | HR company knowledge uploads and their search for account-owned chats                                                         |
| `server/company-documents.mjs`          | Firestore `companyDocuments` and the library rules (one document per topic, twelve documents)                                 |
| `server/onboarding-document-topics.mjs` | The six onboarding topics of the company library                                                                              |
| `server/profile-autofill.mjs`           | Profile autofill: reads profile fields from an uploaded document with Gemini; saves nothing                                   |
| `server/database-migrations.mjs`        | Runs `server/migrations/*.sql` once each, recorded in `schema_migrations`                                                     |
| `server/migrations/`                    | Plain SQL migrations                                                                                                          |
| `server/migrations/firestore/`          | Firestore migrations (`NNN_name.mjs`, `up({ firestore, log })`) and their README                                              |
| `server/firestore-migrations.mjs`       | Runs the Firestore migrations once each, markers in the `schema_migrations` collection, lease lock per file                   |
| `server/migration-runner.mjs`           | `db:migrate` target selection (`MIGRATION_TARGETS`), output and exit codes; the migration file check                          |
| `scripts/migrate-database.mjs`          | `npm run db:migrate`                                                                                                          |
| `scripts/create-hr-account.mjs`         | `npm run hr:create`: the first HR account, password never shown or passed as an argument                                      |
| `scripts/reset-hr-password.mjs`         | `npm run hr:reset-password`: recover an HR account (new password, lock cleared, sessions ended)                               |
| `server/local-setup.mjs`                | The compose `setup` service: guard, migrations, local HR login, `hr-login.json`, banner                                       |
| `scripts/local-stack.mjs`               | Host command for `npm run local*`: starts Docker, runs compose, prints the login summary                                      |
| `scripts/hr-account-tool.mjs`           | Input (terminal without echo, or piped lines) and rules shared by both HR scripts                                             |

## Uploaded company guidance

See [Account and workspace details](account-access.md). `server/guest-workspace-routes.mjs` scopes guest uploads, conversations and reports to an opaque browser cookie. `server/guest-workspace-store.mjs` stores documents and individual employee identities in separate private SQLite storage. `server/read-uploaded-document.mjs` validates files and bounds worker execution; `server/uploaded-document-worker.mjs` extracts PDF/DOCX/text content (profile autofill reuses both, cutting long text to the limit instead of rejecting it). `server/workspace-company-knowledge.mjs` combines the company document search (Vertex AI Search, when `VERTEX_SEARCH_ENGINE_ID` is set) with owner-scoped uploads, which `server/uploaded-document-search.mjs` ranks locally. Guest workspaces always use their own SQLite file, also when saved chats use Firestore.
