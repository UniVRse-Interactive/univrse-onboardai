# HR workspace, Google Docs and automatic reports

## Using the website

1. Open /login/hr, then Continue without an account. /hr opens the HR dashboard. Employee reports and Company documents remain available in the header.
2. Select an employee. Their report has Overview, Statistics and Practical support sections. Reports update from answered questions, explicit support requests and feedback; HR does not write them.
3. Choose Company documents in the header. This swaps the main view without scrolling down the page. The HR screen fits a normal laptop viewport; smaller screens and browser zoom keep a natural reading flow.
4. Choose one of six topics: Welcome & Company Overview, Employee Handbook, First-Day & First-Week Guide, Role & Team Guide, IT & Account Setup Guide, or Communication & Meeting Guide. Paste the native Google Docs link. With local imports enabled, **Save to company Drive** moves that same document into the configured company folder and confirms the connection.
5. Use Add another Google Doc for related guidance such as safety, benefits or accessibility. Give it a short topic name.
6. Open /login/employee and continue without an account. The employee lands on the dashboard before opening Alya. Each employee keeps their own conversations, requests and feedback.
7. Download a report from HR when needed. Add employee creates a separate record; employee pagination preserves access to every record. Removal asks for confirmation and leaves company guidance and other employees intact.

Employee reports, company documents and report sections are manual view choices. Long suggestion lists and additional guides use Previous/Next controls instead of enlarging the main page. Existing employee pages and the Alya chat layout are unchanged by the HR layout update.

## HR dashboard

The overview counts employee records in this browser workspace, hires in the current calendar month from saved joining dates, onboarding in progress, and employees with recorded support requests or unclear feedback. A missing joining date does not become a hire date based on record creation. When no joining dates exist, the new-hires metric shows a dash rather than an invented count.

Select an employee name to enter their joining date and department, and confirm six onboarding milestones: first-day arrangements, orientation, accounts/equipment, team introductions, role/priorities, and the onboarding check-in. Progress is the percentage of these six milestones HR has confirmed. It is independent of question counts, support requests, and the employee's separate device-only checklist. No existing activity automatically marks a milestone complete.

The employee table and support panel use two employees per page. Human-help requests appear first, followed by unclear feedback and explicit explanation preferences. These are recorded signals, not a resolved/unresolved case tracker or a performance score. Shortcuts open the existing individual report or the company document library.

Joining details and milestones are saved per employee in the existing workspace database, retained through server restarts and removed with the employee or expired workspace. Updates validate dates and known milestone IDs, check browser ownership, and reject stale versions to prevent a second tab overwriting newer changes. This remains browser-scoped preview access, not a company-wide authenticated staff directory.

## Google Docs only

The HR form accepts native Google Docs links, not local PDF, Word, text or Markdown uploads. The server checks both the URL and the actual Drive MIME type. A renamed file or a forged Google Docs URL cannot bypass the native-document check. The connected company Google account must be able to export the document as readable text. Documents do not need public sharing.

### Automatic move into the company folder

Set `GOOGLE_DRIVE_DOCUMENT_MOVES=enabled` alongside `GOOGLE_DRIVE_FOLDER_ID` for the local HR site. The writer uses the existing credentials with the Google Drive write scope; the source document needs edit/move access and the destination folder must accept new files. The ordinary answer reader keeps its separate read-only client. An impersonated service account can use its existing authorized delegation; user credentials restricted to read-only Drive need a separately authorized write scope.

The form explains that the Doc becomes shared company guidance. This moves the original Google Doc, preserves its ID and contents, and removes its previous parent folder. It does not create a second copy, transfer ownership explicitly, or call the sharing-permissions API. Google Drive's folder rules and inherited access still apply. See [Google's move operation](https://developers.google.com/workspace/drive/api/guides/folder#move_files_between_folders).

Only confirmed successful moves create a browser connection. Validation and library limits run first; retries check whether the file is already in the destination. A lost update response is verified once without repeating the move. The topic is saved as private Drive app metadata so a separate browser recognises newly imported guides. A tagged core topic cannot receive a second conflicting guide; update the existing Doc in Drive instead.

The saved Doc is now a company-folder source for other browsers as well. It is deduplicated when that browser also owns its local link. Shared documents are managed in Drive; the HR page does not offer a browser-only Disconnect action for them. Their Drive files persist after the browser workspace expires.

**The current HR selector does not verify identity.** Consequently, this write operation accepts only direct loopback requests on the local development server. It rejects production, Cloud Run, trusted proxies and forwarded requests even when the flag is set. Public company-folder writes require verified HR authentication and company authorization first. With the flag off, the existing browser-scoped link-only flow remains available and performs no Drive writes.

Only fixed Google Drive API endpoints are called; the server never fetches an arbitrary submitted URL. URLs are normalised to a Google Doc ID. The reader uses the existing read-only Google authentication, validates type and export access, and applies timeouts and text limits. See [Google's document export API](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export).

Core guides use their general topic names in HR and new answer sources. HR does not display filenames from earlier uploads or list original names from the configured Drive folder. Clear earlier document names are matched to the six topics for display, so already connected guidance shows a tick without being added again. Unknown or ambiguous names do not mark a topic complete, and an explicit HR topic assignment takes precedence. Existing uploaded text is retained; removing a connection does not delete the Google Doc itself.

The configured company Drive folder remains a source alongside linked Google Docs. It supports up to twelve Google Docs, including all six core guides. Six connected topics describes the document library, not an employee's completion or understanding.

Each new question checks current content and access for linked Google Docs. If reading a linked document fails, the answer fails with a safe error rather than using the text saved when it was connected. Existing saved answers are not rewritten when a source changes.

Limits: twelve browser-owned documents, 250,000 readable characters per linked Google Doc, and 750,000 total stored characters. Replacing a core guide reuses its slot. Duplicate links and duplicate content are rejected or treated as an existing connection.

## Ownership, storage and account access

An opaque HttpOnly, SameSite=Strict cookie owns each browser workspace. Every browser document, employee, conversation and report endpoint checks that ownership. Another browser starts with its own workspace but reads the configured shared company folder. Moving a Doc into that folder deliberately makes it company guidance; conversation and report data are not shared across browsers. Guest HR and employee views share their own browser's workspace; the HR selector is not verified role authentication.

The ignored .cache/guest-workspaces/workspaces.sqlite database stores Google Doc IDs, topic names, the text verified when connected, conversations and support observations. The schema migration retains earlier documents and employee activity. Original file bytes are not stored. Records survive a server restart when storage persists and the browser cookie remains.

Workspaces expire after 24 hours without activity; a later request performs cleanup. HR polling counts as activity. Clearing browser cookies loses access. SQLite files are not encrypted by the application, so deployment needs protected persistent storage.

Reports reflect recorded requests and feedback. They do not infer health, intelligence, personality, performance or job suitability. Employee responses do not include aggregate HR reports. The existing private /mira history uses a separate database and cookie; /api/employee-support-summary remains closed with 403 HR_ACCESS_REQUIRED.

Sign-in and sign-up remain interface previews. Real workforce access across computers requires verified identity, company membership and HR authorization, plus the documented hosting controls. This update does not push code or deploy the website.

## Code and verification

- src/access/HrWorkspace.jsx: HR views, individual reports, refresh and employee selection.
- src/access/HrDashboard.jsx and hr-dashboard.css: dashboard, employee table, support shortcuts and onboarding editor.
- src/access/hr-dashboard-insights.mjs: date-based hiring counts and recorded support signals.
- server/hr-onboarding.mjs: shared HR milestone definitions and progress calculation.
- src/access/hr-screen.css: viewport layout and responsive reading surfaces.
- src/access/GoogleDocsLibrary.jsx: six core topics, link form and related guidance.
- src/access/google-docs-library.css: document layout.
- server/onboarding-document-topics.mjs: topic IDs and labels shared with the form.
- server/google-drive-documents.mjs: read-only folder and native Google Doc readers.
- server/google-drive-document-moves.mjs: local import gate, validated moves and idempotent retries.
- server/guest-workspace-routes.mjs: browser ownership, Google Docs connections and chat/report endpoints.
- server/guest-workspace-store.mjs: source metadata, document replacement, employee identities and expiry.
- server/workspace-company-knowledge.mjs: current folder guidance and current linked documents.

Tests use synthetic documents and injected Google/model responses. They check URL and MIME validation, move failures, retries, parent changes, production/forwarded-request blocking, shared company sources, current-policy reads, revoked access, browser isolation, report updates and persistence. They do not perform a live move or establish clinical usefulness. Legacy file-reader modules remain for previously supported extraction tests; the public connection route no longer accepts local files.
