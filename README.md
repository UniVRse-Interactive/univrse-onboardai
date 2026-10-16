# OnboardAi

An employee onboarding assistant with Alya, an animated 3D avatar. Answers include text, server-generated voice and automatic synchronized illustrations around Alya. The supplied ALYA answering brain uses approved company documents; saved chat transcripts remain available in the app.

The active local configuration uses `AI_MODE=alya-brain` with the existing server-only `GEMINI_API_KEY`. The supplied brain answers each question independently, so ambiguous follow-ups may require clarification. See [ALYA brain integration](docs/alya-brain-integration.md) for the copied package, configuration, preserved chat/voice features and verification. The original Vertex engine remains an explicit legacy mode.

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

- [Chat and memory](docs/chat-and-memory.md): Gemini, LangChain, LangGraph, Drive retrieval and saved conversations.
- [Answer styles](docs/answer-styles.md): automatic support, short explanations, steps, examples and brief answers.
- [Visual guides and HR summary](docs/visual-guides-and-hr-summary.md): illustrated answers, feedback and HR summary boundaries.
- [Account interface](docs/account-access.md): login forms, guest views and the current authentication boundary.
- [Avatar provenance](public/avatars/alya/PROVENANCE.md): supplied model, source attribution and rendering/voice dependencies.

The current voice is Kokoro Heart (`af_heart`). Its installed model warms at server startup, and a shorter opening segment lets speech begin before the remaining audio is ready. It runs on the Node server. The website does not use device-specific browser voices. Playback and estimated mouth movement start automatically with new answers when voice is on; mute, stop, speed and reduced movement controls remain available.

The current user-supplied ALYA model is kept as lossless gzip: about 21.1 MiB transferred and 27.7 MiB decoded. Its supplied material and animation helpers retain the model's appearance, blinking, gaze and speech controls. Chat works independently of the 3D model. To import another matching package, run `node scripts/import-avatar-model.mjs <path-to-ALYA.glb>` with its `asset-info.json` and `PROVENANCE.md` alongside it; previous assets are saved in the ignored `.cache/avatar-history/` folder.

## Useful commands

| Command                     | Purpose                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `npm.cmd run dev`           | Start the local development server                                                         |
| `npm.cmd test`              | Check chat, memory, visual answers, audio and assets                                       |
| `npm.cmd run build`         | Build the browser website                                                                  |
| `npm.cmd run format`        | Apply consistent, readable formatting                                                      |
| `npm.cmd run format:check`  | Check formatting without changing files                                                    |
| `npm.cmd run check:share`   | Check the current Git file list for private files, recognised secrets and large assets     |
| `npm.cmd run check:drive`   | Check access to the configured Drive folder                                                |
| `npm.cmd run check:search`  | Check document retrieval                                                                   |
| `npm.cmd run check:gemini`  | Make one small Gemini request to check model access; Google usage limits and billing apply |
| `npm.cmd run voice:prepare` | Download the voice model and generate a local sample                                       |

## Local settings and data

The existing `.env`, saved chats and voice cache remain local. Git and Docker exclude `.env`, credentials, chat databases, private files, generated builds, dependencies and test artifacts. `check:share` is a helpful pattern check, not a guarantee that every confidential value has been identified.

Company chat reads Google Docs directly inside the configured Drive folder. The supplied brain uses `AI_MODE=alya-brain` with `GEMINI_API_KEY`; Drive retains its existing access credentials. The legacy `AI_MODE=gemini-chat` option uses Vertex AI with Application Default Credentials: set `GOOGLE_CLOUD_PROJECT` (and optionally `GOOGLE_CLOUD_LOCATION`, default `global`) and run `gcloud auth application-default login`. Never put credentials in browser code or variables beginning with `VITE_`.

Successful chats are saved in SQLite and belong to an opaque browser-session cookie. The selected chat and voice preferences survive normal refreshes. The editable profile is not employee sign-in. Support summaries describe recorded requests and feedback; they do not diagnose disability or score ability. Employee chat does not display reports or export controls. Employee APIs do not return aggregate summaries. The HR workspace shows live activity for each guest, with individual feedback, support requests, suggested support and check-ins. Guest HR/employee views share an isolated browser workspace; this is not verified HR access. Real employee report access still requires connected authentication and company permissions.

## Company uploads and guest reports

Open `/login/hr` and choose **Continue without an account**. The HR workspace has **Dashboard**, **Employee reports** and **Company documents** views. Its dashboard shows employee records, new hires from saved joining dates, HR-confirmed onboarding progress, support signals and document readiness. Select an employee name to save joining details and confirm six onboarding milestones; chat activity does not complete those milestones.

Connect a native Google Docs link to one of six core onboarding topics, or use **Add another Google Doc** for related guidance. Separate employee access at `/login/employee` opens the employee dashboard before Alya; employee sign-up is at `/signup/employee`. Support reports update from actual questions, requests and feedback; **Add employee** creates a separate record.

Only Google Docs links are accepted for new guidance; the server verifies the actual native file type and read access. Twelve documents are allowed per browser workspace. Existing uploaded text is retained, with earlier filenames hidden in HR. The ignored SQLite database stores source metadata, verified text and conversations; workspaces expire after 24 hours without activity. See [HR and document details](docs/guest-workspace.md) for limits and account boundaries.

For local HR imports, `GOOGLE_DRIVE_DOCUMENT_MOVES=enabled` changes the form to **Save to company Drive**. It moves the original Google Doc into the configured company folder using the connected account's edit permission. The guidance then becomes available to other browsers through that folder. Failed moves do not create a misleading connection. Company-folder writes are blocked on public/production and forwarded requests until verified HR access is implemented; ordinary link-only connections remain available with the flag off.

The employee assistant reads connected Google Drive guidance plus current linked Google Docs and retained earlier guidance. The server selects the configured answer engine. Gemini uses Vertex AI with Application Default Credentials and the configured project's quota; relevant passages are sent to Google. There is no model selector in the website. The existing private `/mira` chat history remains available separately.

## GitHub and hosting later

GitHub shares the source code. A running website still needs a hosted Node server and its private configuration. These interface changes do not deploy or publish a website.

A running version needs a Node server with enough memory for Kokoro and persistent private storage for SQLite. A static GitHub Pages site alone cannot run these backend features. The existing Dockerfile provides a starting point; its container has not been verified here.

The company assistant currently has no employee sign-in. Its private Drive knowledge needs access protection before an unrestricted online rollout. The dependency audit currently reports nine entries in the existing voice tree and Mammoth’s CLI parser dependency. There is no compatible automatic fix. Review these during hosting preparation; the upload reader uses Mammoth’s raw-text API, not its CLI.

## Verification after cleanup

Automated checks cover document extraction, native Google Docs validation, current linked guidance, browser/guest isolation, live reports, persistence and expiry. Automated Gemini checks use injected model responses. The supplied brain was also checked with a live Gemini greeting and a company question in the application. Visual scenes and captions advance automatically with Alya's voice. The Docker container has not been verified here.
