# OnboardAi

Employee onboarding with ALYA, the existing animated 3D companion. The application combines a dashboard, company-grounded chat, illustrated guidance, and an HR preview workspace. The avatar model, face, clothing, materials and animation implementation are preserved from the local project.

## Run locally

Use Node.js 22 or later. Keep your existing `.env`.

```sh
npm ci
# For a fresh installation only: cp .env.example .env
npm run voice:prepare
npm run dev
```

Open http://localhost:3000. On Windows use `npm.cmd` and `Copy-Item .env.example .env` for a fresh setup. To serve a production build: `npm run build` then `npm start`.

## Access and pages

Choose Employee or HR preview. Employee access accepts an existing profile ID, creates a profile without a password, or opens a new guest profile. Guests first reach the dashboard and can choose Ask Alya.

| Route         | Contents                                                            |
| ------------- | ------------------------------------------------------------------- |
| `/`           | Employee dashboard and next actions                                 |
| `/onboarding` | Suggested checklist; completion is manually recorded                |
| `/support`    | Support directory and personal notes                                |
| `/mira`       | ALYA, manual Chat / Visual guide switch and shared voice controls   |
| `/hr`         | HR preview: guidance uploads and factual employee support summaries |

**This is browser-scoped preview access, not authentication.** Anyone using the same browser workspace can choose HR preview. Employee IDs are labels, not secrets. There is no verified HR role, password login, cross-device account synchronisation or company-wide employee directory. Production requires server-verified identity, roles and guidance permissions before exposing private company material.

An opaque HttpOnly cookie owns the preview workspace. Every employee has a stable internal UUID; removing or renumbering employees never reassigns their histories. Removing an employee erases their server chats and support events. Dashboard state is separately keyed by employee UUID in local storage. Existing legacy browser chats and dashboard state are retained, but are not automatically assigned to new employees. Clearing cookies loses access to the workspace. Switching profiles in another tab requires reopening the employee workspace before sending more requests.

## Company answers and documents

The existing configured provider is preserved. `AI_MODE=gemini-chat` enables Gemini with saved context and source-supported answers. The blank `.env.example` defaults to labelled sample answers. No provider fallback is introduced. Keep credentials in server `.env`, never in `VITE_` variables or browser code.

In Gemini chat, HR's uploaded UTF-8 `.txt` and `.md` guidance is retrieved together with the configured Google Drive guidance. Uploads are limited to 100 KB each, 10 files, and 120,000 uploaded characters; combined Drive and uploaded text must also fit 120,000 characters. PDF/Word processing is not added. Errors are visible; no old document snapshot is substituted after a failed Drive read. Removal affects subsequent retrieval, not historical answers already saved in conversations.

Drive reads at most five Google Docs directly inside the configured folder. For deliberately public guidance, use `GOOGLE_DRIVE_ACCESS=public`; both folder and documents must allow anonymous viewing/export. This uses Google's public folder HTML and text exports, so markup changes may require maintenance. Private folders retain the authenticated Drive API reader. Never make confidential material public merely to connect this preview.

The existing `document-search` mode remains a lexical Drive-only preview without conversation memory or support recording. Demo mode uses labelled sample answers. Uploaded guidance and recorded HR support currently require `gemini-chat` for answering. Gemini receives recent conversation context and selected company passages. Missing evidence leads to clarification or a referral to HR; source validation is not a guarantee that every generated sentence is correct.

## Reading, voice and reports

Chat and Visual guide are separate manually selected views; answering does not switch views or scroll the page. The avatar remains alongside the reading area on desktop and sticky above it on narrow screens. Questions can only be entered in Chat. Visual guides retain written guidance, numbered steps where supported, illustrations, Back/Next and Full answer. Viewing a guide does not complete a task or measure understanding.

Kokoro Heart remains the shared server voice. Mute, stop, speed and reduced movement controls remain available in both reading views. Audio failure does not prevent reading text; speech mouth timing remains approximate. The existing compressed digital-human model is about 21 MB and can take time to load on slower devices; chat works independently.

HR reports start empty and show only recorded answers, explicitly requested formats, helpful/still unclear feedback and requests for human help, with deterministic check-in suggestions. They contain no transcripts, document passages, diagnoses or ability/performance judgments. Reports are shown in HR, not in employee chat. Human help records a request and directs the employee to support; it does not send a notification. The shared browser preview cannot enforce real-world HR confidentiality.

Chats and support events follow existing 30-day conversation retention. Profiles/uploads remain until removed. SQLite lives in ignored `.cache/chat/conversations.sqlite` (or `CHAT_DATABASE_PATH`); it is not encrypted. Protect local storage and backups. Multi-instance deployment needs shared persistence and locking.

## Checks and implementation notes

```sh
npm test
npm run build
npm run check:share
npm run check:drive
npm run check:gemini
```

The last two commands contact configured services; the Gemini check incurs normal API usage. Tests use synthetic company documents and injected model responses. There is no separate type-check or lint script; JavaScript tests, Vite build and Prettier are available. See [verification notes](docs/workspace-verification.md) for checks actually performed and review limitations.

- [File guide](docs/file-guide.md)
- [Chat and memory](docs/chat-and-memory.md)
- [Visual guides and HR summaries](docs/visual-guides-and-hr-summary.md)
- [Avatar provenance](public/avatars/alya/PROVENANCE.md)

`.env`, credentials, databases, caches, dependencies and generated builds stay ignored. Run `check:share` and inspect the staged diff before sharing. A Node server and persistent private storage are required; a static hosting service alone cannot run chat or voice. This change is for feature-branch review, not deployment.
