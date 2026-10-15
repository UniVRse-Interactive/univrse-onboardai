# Developer file guide

The project stays in JavaScript and React. `.jsx` files contain React screens; `.js` and `.mjs` contain JavaScript; `.css` files control appearance. `.mjs` makes the server's module format explicit.

## Main folders

| Folder                 | What it contains                                                               |
| ---------------------- | ------------------------------------------------------------------------------ |
| `src/portal/`          | The website shell and the welcome, onboarding and support pages                |
| `src/avatar/`          | Alya's chat screen, avatar rendering, answer visuals and support summary       |
| `server/`              | API routes, Gemini workflow, document search, saved chats and voice generation |
| `scripts/`             | Development, connection checks, avatar import and voice setup                  |
| `tests/`               | Regression checks using temporary data and synthetic company documents         |
| `public/avatars/alya/` | The original avatar, loading poster and asset information                      |
| `docs/`                | Architecture and behaviour explanations                                        |

`node_modules`, `dist`, `.cache` and `artifacts` are generated or private working folders. They are excluded from sharing. `.env` holds this installation's private settings; `.env.example` is the blank setup template.

## Start reading here

1. `src/main.jsx` starts React and redirects old page addresses.
2. `src/portal/OnboardingWebsite.jsx` selects a page and renders the website shell.
3. `src/avatar/AlyaChatPage.jsx` submits questions and displays chat, the avatar, visual answers and the employee summary.
4. `server/index.mjs` starts the HTTP server and serves the website and compressed avatar.
5. `server/api-routes.mjs` handles browser requests and calls the appropriate chat or voice service.

## Website

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

## Avatar and voice

| File                                         | Purpose                                                  |
| -------------------------------------------- | -------------------------------------------------------- |
| `src/avatar/AvatarDisplay.jsx`               | Avatar loading, presence and poster fallback             |
| `src/avatar/avatar-renderer.js`              | Three.js camera, light, model, face and gentle movement  |
| `src/avatar/answer-audio-player.js`          | Fetch server audio, play it and cancel safely            |
| `src/avatar/speech-text-and-mouth-timing.js` | Prepare spoken text and estimate English mouth timing    |
| `src/avatar/alya-chat.css`                   | Chat/avatar layout and chat controls                     |
| `server/kokoro-voice.mjs`                    | Fixed Kokoro Heart voice, synthesis queue and WAV output |
| `scripts/download-voice-model.mjs`           | Cache the voice model and create a sample                |
| `scripts/import-avatar-model.mjs`            | Import and compress a revised original GLB               |

The browser plays WAV audio from `/api/voice`. Mouth movement follows the audio clock using estimated phonemes. The unused browser-voice controller was removed; text and mouth-timing helpers remain because the current player uses them.

`server/optional-windows-voice.mjs`, `server/windows-audio-mouth-timing.mjs`, `scripts/start-windows-voice-helper.ps1` and `scripts/WindowsVoiceHelper.cs` support the existing optional Windows TTS route. They are retained because the server still calls them. The current website's shared voice uses Kokoro.

## Visual answers and HR summary

| File                                      | Purpose                                                         |
| ----------------------------------------- | --------------------------------------------------------------- |
| `src/avatar/VisualAnswerPanel.jsx`        | Separate visual workspace and answer selection                  |
| `src/avatar/IllustratedAnswer.jsx`        | Interactive picture selection and readable explanation          |
| `src/avatar/AnswerIllustrations.jsx`      | Original SVG subject illustrations                              |
| `src/avatar/visual-answer-content.mjs`    | Build a visual explanation from the delivered answer            |
| `src/avatar/visual-answer.css`            | Visual-panel styling and keyboard focus                         |
| `src/avatar/EmployeeSupportSummary.jsx`   | Live employee overview and reviewed export dialog               |
| `src/avatar/hr-support-report.mjs`        | The concise report text exported for HR                         |
| `src/avatar/employee-support-summary.css` | Summary and export-dialog styling                               |
| `server/employee-support-tracking.mjs`    | Recorded support requests, feedback and summary templates       |
| `server/answer-guide-metadata.mjs`        | Source-supported guide metadata for existing saved-chat records |

The persisted/API field named `card` remains compatible with existing chats and guide counts. It is metadata; the interface uses the separate visual panel. UI component renames do not rename database fields, cookies or local preference keys.

## Useful script names

- `start-development-server.mjs`: start Node with file watching and Vite live updates.
- `check-gemini-connection.mjs`: check Gemini with one small live request.
- `check-vertex-ai-search.mjs`: check Vertex AI Search with one live search (`npm run check:search`).
- `import-company-documents.mjs`: upload a folder to the documents bucket and import it into Vertex AI Search (`npm run docs:import`, dry run by default).
- `check-shareable-files.mjs`: inspect the Git file list without printing secrets or publishing files.

Use the `npm` commands in the README rather than remembering these file paths.

## What was cleaned up

Ambiguous names such as `Portal`, `AvatarStage`, `conversation` and `drive-knowledge` were replaced with names that describe their role. The architecture notes are grouped in `docs/`. Compressed source formatting is expanded consistently with Prettier. Tests and imports follow the new names.

The existing removed pages and old standalone avatar demos stay removed. The unused device-voice controller and its obsolete tests were replaced with checks for the active audio player. The original avatar, live settings, saved conversations and voice cache are preserved.
