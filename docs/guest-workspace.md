# Company knowledge, employee chat and automatic HR reports

These are working features inside the existing OnboardAi website.

## Flow

1. On /login, choose HR, then Continue without an account. The HR page is /hr.
2. The employee summaries appear first. Reports are generated automatically from employee questions, explicit explanation requests and feedback. HR does not write the report. There is no report form or manual follow-up note.
3. Company documents appear below the reports. The library shows browser-scoped website uploads, and an error if the company document search is configured incompletely. Files can be PDF, DOCX, UTF-8 TXT or Markdown.
4. Open the login page separately and choose Employee → Continue without an account. This opens /employee/<id>. The Employee and HR pages do not contain buttons that switch roles or return to sign-in. Old /guest/employee URLs remain compatible.
5. Ask Alya a question or request a smaller explanation, example or brief answer. Helpful / Still unclear and requests for human help also update the employee’s report. The HR page refreshes every ten seconds while visible and on tab focus.
6. Download the automatic support summary from HR if needed. No email, notification or task assignment is sent.

The answer engine is configured by the server, with no user-facing selector or technical status strip. AI_MODE=document-search uses source excerpts; otherwise GOOGLE_CLOUD_PROJECT enables conversational answers through Gemini on Vertex AI with Application Default Credentials. Missing or failed Gemini access remains visible rather than silently switching engines. Relevant source passages and recent conversation context are sent to Google in Gemini mode.

Every employee starts with zero activity. The two synthetic employee reports were removed. Document guidance is shared across the guests in one workspace; histories, preferences, feedback and reports are individual. Report recommendations use recorded explicit requests and feedback. No diagnosis, intelligence estimate, personality or employment assessment is inferred.

## Ownership and storage

An opaque HttpOnly, SameSite=Strict cookie owns each browser workspace. Every file, guest, conversation and report endpoint verifies that ownership. Guest IDs do not grant access. Another browser starts with an empty workspace. Guest HR and employee views intentionally share their own browser's workspace; this does not verify an HR role.

The ignored `.cache/guest-workspaces/workspaces.sqlite` database stores extracted document text, employee conversations and support observations. It is always SQLite, also when `FIRESTORE_DATABASE_ID` moves the saved chats to Firestore; on Cloud Run it lives on the instance and does not survive a new instance. Original uploaded bytes are not retained. Workspace records survive a server restart when the storage folder persists; the browser cookie must also remain. The application does not encrypt SQLite files; protect the server folder and backups.

Workspaces expire after 24 hours without activity. Cleanup runs on a later workspace request, not a background timer. Clearing cookies loses access; abandoned records are cleaned after expiry. Polling an open HR page counts as activity.

Existing saved conversations and private reports use their original store (SQLite or Firestore) and cookie. Employee retrieval searches the same company documents as `/mira` (Vertex AI Search, when `VERTEX_SEARCH_ENGINE_ID` is set), plus that browser’s uploads. Company and upload passages alternate, each in its own rank order: up to six for Gemini, up to two quoted passages in document search. Uploads are ranked locally and never imported into the shared search data store. Without a search engine the workspace answers from its uploads only, and an employee question before the first upload returns `409 WORKSPACE_KNOWLEDGE_EMPTY`; the built-in sample guide is not mixed into uploaded guidance. A company search failure returns its `SEARCH_*` code and a fixed message. It never opens the separate private chat/report store. Existing paused recording preferences are untouched. `/mira` remains the configured company-search/sample assistant; Employee access from login uses the combined company guidance and live reports. Existing private chat history remains at /mira. The old private summary endpoint remains closed with `403 HR_ACCESS_REQUIRED`.

Employee responses do not include aggregate reports. The HR workspace response contains aggregate counts and descriptions, not raw questions, transcripts or document text. Removing a file affects future retrieval; previously saved answers/source excerpts remain until their chat is deleted or the workspace expires.

## Upload limits and readers

- Twelve documents and five guest employees per workspace.
- 5 MiB per upload, 250,000 extracted characters per document and 750,000 total characters.
- Text-based PDFs, up to 150 pages; no OCR for scanned pages. Password-protected or unreadable files produce a clear error.
- Reader workers have a 20-second deadline, a bounded heap and at most two concurrent readers. They do not inherit development-server watcher flags.
- DOCX ZIP entry count and expanded size are checked before parsing. Mammoth external file access remains disabled.
- Only extracted text is used, never uploaded HTML. File names and types are validated. Identical text is deduplicated within the workspace.
- Document parsing uses [PDF.js's Node API](https://github.com/mozilla/pdf.js/blob/master/examples/node/getinfo.mjs) and [Mammoth's raw-text API](https://github.com/mwilliamson/mammoth.js#api). Node.js 22.13+ is required; current checks use Node.js 24.

## Authentication and hosting

The login/signup forms remain an interface. Selecting HR or entering a password does not create an account or grant workforce access. Use approved information for temporary-access uploads.

For real employees across different computers, connect server-verified identity, company membership and HR authorization at every document, chat and report endpoint. Decide reporting consent and retention with the company. Add HTTPS, persistent private storage and deployment abuse controls. This change does not publish the website or push to GitHub.

## Code map and checks

| File                                     | Responsibility                                            |
| ---------------------------------------- | --------------------------------------------------------- |
| `src/access/HrWorkspace.jsx`             | Live reports, employee selection and automatic summaries  |
| `src/access/CompanyDocumentLibrary.jsx`  | Uploads, removal and company-source status                |
| `src/access/GuestEmployeeEntry.jsx`      | Reopen the active guest                                   |
| `src/access/guest-workspace-api.js`      | Workspace API and route helpers                           |
| `src/access/hr-report-insights.mjs`      | Team counts and explicit activity labels                  |
| `src/access/hr-workspace.css`            | Library and live report layout                            |
| `server/guest-workspace-routes.mjs`      | Cookie ownership and scoped endpoints                     |
| `server/guest-workspace-store.mjs`       | Guest identities, text and expiry                         |
| `server/workspace-company-knowledge.mjs` | Combine company document search with owner-scoped uploads |
| `server/uploaded-document-search.mjs`    | Local passage splitting and ranking of uploaded documents |
| `server/read-uploaded-document.mjs`      | Validation, worker limits and timeouts                    |
| `server/uploaded-document-worker.mjs`    | PDF/DOCX/text extraction                                  |
| `tests/guest-workspace.test.mjs`         | Upload-to-report flow, ownership, persistence and expiry  |
| `tests/uploaded-documents.test.mjs`      | Real PDF/DOCX fixtures, watcher flags and invalid files   |

Tests use synthetic documents and injected model responses. They verify routing, grounding inputs and persistence, not live Gemini availability or clinical usefulness. The voice dependency tree has existing advisories; the current audit also includes Mammoth's CLI argument-parser dependency. The raw-text upload route does not invoke that CLI. Review dependencies before public deployment rather than accepting an incompatible automatic downgrade.
