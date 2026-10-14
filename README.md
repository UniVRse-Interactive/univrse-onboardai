# UniVRse OnboardAi

An employee onboarding assistant with Alya, the original 3D avatar. Answers can include text, the same server-generated voice for everyone, and a separate illustrated visual panel. Gemini uses approved company documents and saved conversation context.

## Run locally

Use Node.js 22 or later; development has been checked with Node.js 24.

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

| Address       | Contents                                                    |
| ------------- | ----------------------------------------------------------- |
| `/`           | Welcome, next steps and progress                            |
| `/onboarding` | Suggested tasks, filters and a local checklist              |
| `/support`    | Support directory and personal notes                        |
| `/mira`       | Alya, chat, visual answers and the employee support summary |

Inside UniVRse, Launchpad and the handbook page have already been removed. Their old addresses lead to Alya. Suggested checklist items and support roles are editable templates, not verified company instructions.

## Understand and edit the code

Start with the [file guide](docs/file-guide.md). The project uses JavaScript, React and CSS. File names describe their purpose; conventional entry points such as `src/main.jsx` and `server/index.mjs` are retained.

- [Chat and memory](docs/chat-and-memory.md): Gemini, LangChain, LangGraph, Drive retrieval and saved conversations.
- [Answer styles](docs/answer-styles.md): automatic support, short explanations, steps, examples and brief answers.
- [Visual guides and HR summary](docs/visual-guides-and-hr-summary.md): illustrated answers, feedback and reviewed report export.
- [Avatar provenance](public/avatars/alya/PROVENANCE.md): original asset and rendering/voice dependencies.

The current voice is Kokoro Heart (`af_heart`). It runs on the Node server. The website does not use device-specific browser voices. Playback and estimated mouth movement start automatically with new answers when voice is on; mute, stop, speed and reduced movement controls remain available.

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
| `npm.cmd run check:drive`   | Check access to the configured Drive folder                                                |
| `npm.cmd run check:search`  | Check document retrieval                                                                   |
| `npm.cmd run check:gemini`  | Make one small Gemini request to check model access; Google usage limits and billing apply |
| `npm.cmd run voice:prepare` | Download the voice model and generate a local sample                                       |

## Local settings and data

The existing `.env`, saved chats and voice cache remain local. Git and Docker exclude `.env`, credentials, chat databases, private files, generated builds, dependencies and test artifacts. `check:share` is a helpful pattern check, not a guarantee that every confidential value has been identified.

Company chat reads Google Docs directly inside the configured Drive folder. Enable it with `AI_MODE=gemini-chat` and the server-only settings in `.env`. Never put API keys in browser code or variables beginning with `VITE_`.

Successful chats are saved in SQLite and belong to an opaque browser-session cookie. The selected chat and voice preferences survive normal refreshes. The editable profile is not employee sign-in. Support summaries describe recorded requests and feedback; they do not diagnose disability or score ability. Employees review their summary before downloading it for HR.

## GitHub and hosting later

The files are prepared locally. No repository has been uploaded and no website has been deployed. GitHub setup and sharing can be done in the next step when requested.

A running version needs a Node server with enough memory for Kokoro and persistent private storage for SQLite. A static GitHub Pages site alone cannot run these backend features. The existing Dockerfile provides a starting point; its container has not been verified here.

The company assistant currently has no employee sign-in. Its private Drive knowledge needs access protection before an unrestricted online rollout. The current dependency audit also reports seven entries in the Kokoro/Transformers voice dependency tree without an automatic fix; review them during hosting preparation.

## Verification after cleanup

All 52 tests, the production build, formatting check and shareable-file check passed. The running chat page was checked with its original avatar, existing saved conversation, visual panel and employee support summary; no browser errors were reported. This cleanup did not make a live Gemini request or build the Docker container.
