# Visual guides and HR support summaries

Open employee preview, then Ask Alya. **Chat** and **Visual guide** are manual view choices beside the unchanged 3D avatar. Answers do not switch the view or scroll the page. Questions are entered only in Chat. Mute, stop and voice settings remain available outside the two views.

The visual guide uses delivered answer text, not an additional model-generated policy. Explicit action sequences become numbered steps; facts are not falsely presented as processes. Pictures have equivalent text. Back/Next, picture selection, All details, original wording and Full answer retain access to complete instructions and conditions. Unsourced replies remain whole, without invented policy illustrations. Reading uses normal page flow instead of a short vertically scrolling panel. The avatar is sticky alongside desktop content and above narrow-screen content. Browser/zoom validation remains pending when no connected browser is available.

Smaller steps, Show example and Keep it brief ask explicit follow-ups. Helpful/Still unclear ratings can be corrected or removed. Human support requests are recorded and point to the support directory; no message is sent to HR. Reading a step does not mark a task complete or record understanding.

## HR workspace

Switch access to HR preview. The document library and employee list appear together. Select a profile to see its factual support summary. New profiles start empty. Counts and suggestions use recorded answers, directly requested formats, explicit feedback and human-help requests. They do not infer disability, neurodivergence, learning speed, intelligence, personality, understanding, performance, completion or suitability. Aggregate totals contain counts only, not transcripts or document text.

Reports use stable employee UUIDs, not editable IDs or list numbering. Removing a profile deletes its chats/events; another employee's records are never reassigned. Removing a chat removes its related observations. Existing retention and idempotent answer processing remain in force. Historic activity is not retrospectively inferred. Old standalone report-export components remain unused for compatibility; the employee chat no longer mounts them or fetches its HR report.

This is **local browser preview access**, not verified HR authentication. Anyone sharing the browser workspace can choose HR. Other browser workspaces cannot access those records by guessing an employee/chat/document ID. A production HR system needs verified authentication and role enforcement.

## Files and tests

- `server/preview-workspace.mjs`: browser workspace, stable employee IDs, validated uploads, HR routes and report projection.
- `server/api-routes.mjs`: session integration and combined company retrieval.
- `src/portal/WorkspaceAccess.jsx`: access choices, uploads, employees and HR summaries.
- `src/avatar/AlyaChatPage.jsx`: manual reading modes and preserved voice/chat controls.
- `src/avatar/VisualAnswerPanel.jsx`, `IllustratedAnswer.jsx`, `visual-answer-content.mjs`: existing conservative visual guidance.
- `tests/preview-workspace.test.mjs`: upload validation, combined retrieval, role/workspace isolation, stale-tab protection and stable employee ownership.
- Existing support-tracking and visual-content tests cover explicit signals, corrected ratings, retention, exact conditions, sources and unsourced answers.
