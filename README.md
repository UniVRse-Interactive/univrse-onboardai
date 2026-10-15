# OnboardAi

An employee onboarding assistant with Alya, the original 3D avatar. Answers can include text, the same server-generated voice for everyone, and a separate illustrated visual panel. Gemini uses approved company documents and saved conversation context.

## Run locally

Use Node.js 22.13 or later; development has been checked with Node.js 24.

For a fresh copy of the project, run these commands in its folder:

```powershell
npm.cmd ci
Copy-Item .env.example .env
npm.cmd run voice:prepare
npm.cmd run dev
```

**Keep your existing `.env` if this project is already configured.** The example contains no credentials and starts with sample answers. The first voice setup downloads the Kokoro model into the ignored `.cache` folder.

Open [the website](http://localhost:3000/) or [Alya's chat](http://localhost:3000/mira).

### Local setup with HR and employee accounts

Accounts are optional. They need Docker for PostgreSQL and the Firestore emulator (`compose.yaml`):

1. Add to `.env` (the values are local placeholders from `compose.yaml`, also listed in `.env.example`):

   ```
   DATABASE_URL=postgresql://onboardai:onboardai_local@127.0.0.1:5442/onboardai
   FIRESTORE_EMULATOR_HOST=127.0.0.1:8681
   FIRESTORE_PROJECT_ID=demo-onboardai
   FIRESTORE_DATABASE_ID=(default)
   ```

2. Start the databases, create the tables and the first HR account, then the app:

   ```bash
   npm run db:up       # PostgreSQL on 127.0.0.1:5442, Firestore emulator on 127.0.0.1:8681
   npm run db:migrate  # safe to run again
   npm run hr:create   # asks for the HR ID and password (not shown)
   npm run dev
   ```

HR then creates employee accounts with temporary passwords; employees choose their own password at first sign-in. With these settings the server refuses to start without the emulator, so local test personal data never reaches a cloud database. Without `DATABASE_URL` the app runs as before, with guest access only. See [Account access](docs/account-access.md) for roles, rules and the API.

To serve a production build locally:

```powershell
npm.cmd run build
npm.cmd start
```

## Pages

| Address              | Contents                                                             |
| -------------------- | -------------------------------------------------------------------- |
| `/`, `/login`        | Employee/HR login interface and guest entry                          |
| `/signup`            | Employee sign-up interface                                           |
| `/dashboard`         | Welcome, next steps and progress                                     |
| `/onboarding`        | Suggested tasks, filters and a local checklist                       |
| `/support`           | Support directory and personal notes                                 |
| `/mira`              | Alya with manual Chat / Visual guide tabs                            |
| `/hr`, `/hr-preview` | Company uploads, live guest reports and automatic employee summaries |
| `/employee`          | Open the active guest using uploaded company guidance                |
| `/employee/<id>`     | One guest’s own Alya conversations, voice and visual guide           |

Inside UniVRse, Launchpad and the handbook page have already been removed. Their old addresses lead to Alya. Suggested checklist items and support roles are editable templates, not verified company instructions.

## Understand and edit the code

Start with the [file guide](docs/file-guide.md). The project uses JavaScript, React and CSS. File names describe their purpose; conventional entry points such as `src/main.jsx` and `server/index.mjs` are retained.

- [Chat and memory](docs/chat-and-memory.md): Gemini, LangChain, LangGraph, Vertex AI Search and saved conversations.
- [Answer styles](docs/answer-styles.md): automatic support, short explanations, steps, examples and brief answers.
- [Visual guides and HR summary](docs/visual-guides-and-hr-summary.md): illustrated answers, feedback and HR summary boundaries.
- [Account access](docs/account-access.md): HR and employee accounts, local setup, the data split, the account API and guest views.
- [Avatar provenance](public/avatars/alya/PROVENANCE.md): original asset and rendering/voice dependencies.

The current voice is Kokoro Heart (`af_heart`). Its installed model warms at server startup, and a shorter opening segment lets speech begin before the remaining audio is ready. It runs on the Node server. The website does not use device-specific browser voices. Playback and estimated mouth movement start automatically with new answers when voice is on; mute, stop, speed and reduced movement controls remain available.

The original avatar is kept as lossless gzip. Its transfer is about 52.4 MiB; its decoded model is much larger, so loading may take time on slower devices. Chat works independently of the 3D model.

## Useful commands

| Command                     | Purpose                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `npm.cmd run dev`           | Start the local development server                                                         |
| `npm.cmd test`              | Check chat, memory, visual answers, audio and assets                                       |
| `npm.cmd run build`         | Build the browser website                                                                  |
| `npm.cmd run format`        | Apply consistent, readable formatting                                                      |
| `npm.cmd run format:check`  | Check formatting without changing files                                                    |
| `npm.cmd run check:share`   | Check the current Git file list for private files, recognised secrets and large assets     |
| `npm.cmd run check:search`  | Run one Vertex AI Search query and list the matching files; Google usage billing applies   |
| `npm.cmd run check:gemini`  | Make one small Gemini request to check model access; Google usage limits and billing apply |
| `npm.cmd run voice:prepare` | Download the voice model and generate a local sample                                       |
| `npm.cmd run db:up`         | Start local PostgreSQL and the Firestore emulator (Docker) and wait until they are healthy |
| `npm.cmd run db:migrate`    | Create or update the account tables; safe to repeat                                        |
| `npm.cmd run hr:create`     | Create an HR account; the password is prompted for, never passed as an argument            |

## Local settings and data

The existing `.env`, saved chats and voice cache remain local. Git and Docker exclude `.env`, credentials, chat databases, private files, generated builds, dependencies and test artifacts. `check:share` is a helpful pattern check, not a guarantee that every confidential value has been identified.

Company chat searches the approved company documents with Vertex AI Search. Enable it with `AI_MODE=gemini-chat` and the server-only settings in `.env`. Gemini and the search use Application Default Credentials: set `GOOGLE_CLOUD_PROJECT` (and optionally `GOOGLE_CLOUD_LOCATION`, default `global`), set `VERTEX_SEARCH_ENGINE_ID` (and optionally `VERTEX_SEARCH_LOCATION`, default `global`) and run `gcloud auth application-default login`. Without `VERTEX_SEARCH_ENGINE_ID`, chat answers from the built-in sample onboarding guide. Never put credentials in browser code or variables beginning with `VITE_`.

Successful chats are saved locally in SQLite, or in Firestore when `FIRESTORE_DATABASE_ID` is set (the cloud setting), and belong to an opaque browser-session cookie, or to the signed-in account when accounts are on. The selected chat and voice preferences survive normal refreshes. The editable profile on the portal is not the HR-managed employee profile. Support summaries describe recorded requests and feedback; they do not diagnose disability or score ability. Employee chat does not display reports or export controls. Employee APIs do not return aggregate summaries. The HR workspace shows live activity for each guest, with individual feedback, support requests, suggested support and check-ins. Guest HR/employee views share an isolated browser workspace; this is not verified HR access. Real employee report access still requires connected authentication and company permissions.

## Company uploads and guest reports

On the login page choose HR → Continue without an account. Upload a PDF, DOCX, TXT or Markdown guide on the HR page, then use Employee access from the login page to ask Alya about it. HR sees that employee’s updated support summary automatically. **Add employee** creates a separate employee record; the uploaded library is shared within this browser’s workspace. Each report starts with actual activity.

Uploads are limited to 5 MB each and twelve files. Text-based PDFs are supported; scanned pages need a readable copy. A separate ignored SQLite database stores extracted text and conversations (always SQLite, also when `FIRESTORE_DATABASE_ID` is set); workspaces expire after 24 hours without activity and are cleaned on a later request. Another browser gets its own empty workspace. See [Account and workspace details](docs/account-access.md) for limits and the authentication boundary.

The employee assistant searches the company documents with Vertex AI Search when `VERTEX_SEARCH_ENGINE_ID` is set, plus that workspace’s uploaded files; without the engine it answers from the uploads only. The server selects the configured answer engine. Gemini uses Vertex AI with Application Default Credentials and the configured project's quota; relevant passages are sent to Google. There is no model selector in the website. The existing private `/mira` chat history remains available separately.

## GitHub and hosting later

GitHub shares the source code. A running website still needs a hosted Node server and its private configuration. These interface changes do not deploy or publish a website.

A running version needs a Node server with enough memory for Kokoro, and Firestore (or persistent private storage for SQLite) for saved chats. A static GitHub Pages site alone cannot run these backend features. The existing Dockerfile provides a starting point; its container has not been verified here.

Employee and HR sign-in runs locally (PostgreSQL and the Firestore emulator); Cloud SQL and the hosted environments do not have it yet. Private company documents need access protection before an unrestricted online rollout. The dependency audit currently reports nine entries in the existing voice tree and Mammoth’s CLI parser dependency. There is no compatible automatic fix. Review these during hosting preparation; the upload reader uses Mammoth’s raw-text API, not its CLI.

## Verification after cleanup

All 72 tests and the production build pass, including document extraction, browser/guest isolation, file changes, live reports, persistence and expiry. Automated Gemini checks use injected model responses; they do not validate live provider availability. The question box appears only in Chat; the visual guide uses Next/Back pages rather than an internal scrollbar. The Docker container has not been verified here.
