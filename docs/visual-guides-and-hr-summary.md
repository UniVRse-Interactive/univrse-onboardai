# Alya: visual answers and onboarding support summary

## Try the first version

Open `/mira`. Ask a company or onboarding question, for example “How do I prepare for an internal meeting? Explain it step by step.”

- A larger Alya portrait stays visible beside one reading area. Choose **Chat** or **Visual guide** using the manual tabs. The question box appears only in Chat. The visual view uses that space for the guide and retains a compact voice toolbar. Changing views preserves the draft, chat position, selected guide section and reading page. Arrow keys move tab focus; Enter or Space selects the view. The last chosen view is remembered on this browser. Phones keep the avatar above the selected view; short or highly zoomed screens allow page scrolling so controls remain reachable.
- The guide content updates with each answer, but the selected view never changes automatically. A **New** badge identifies a newly available guide while reading chat. There are no scroll-to-visual buttons or automatic page jumps. The **Answer** selector reopens a guide from the current conversation.
- Numbered sections select one original subject illustration and its explanation. The reading area measures its available space and divides longer text into pages. Use Next/Back to continue within a section and then move between sections; no internal scrollbar is needed. More than four sections use a compact selector to avoid wrapping the toolbar. Repeated time badges and the question strip are omitted on short sheets; the paragraph retains the complete time wording. The selection describes where the employee is reading, not task completion. The **Full answer** dialog preserves all delivered wording and closes with Escape; **Full answer** contains the original wording when a narrow plain-language rewrite was used.
- Open Need another explanation? for Smaller steps, Show example and Keep it brief. These controls set the corresponding answer style and ask a follow-up about that answer's question. The five styles remain available in Answer style.
- Helpful / Still unclear feedback is saved per answer. Selecting an existing rating removes it; changing a rating replaces it.
- I need a person saves a support request in the conversation and shows a route to the support directory. It does not contact HR.
- Per-answer Read aloud controls have been removed. Automatic voice, mute, stop and speed controls remain. Reduce avatar movement is available in voice settings; the avatar stays visible and retains speech mouth movement.

The visual panel uses the delivered answer rather than asking Gemini to generate another summary. It has original, scalable SVG illustrations on an ivory reading surface with navy type, numbered navigation and gold highlights. Known verbose phrases can be shortened through narrow grammatical rewrites; conditions, exceptions, negatives and approval wording prevent those rewrites. **Full answer** preserves the complete delivered text in a separate dialog. There is no expandable original-wording block inside the guide. Policy terms such as “not allowed”, “only”, “unless” and “weekdays” receive visual emphasis without altering their wording. Clothing pictures depict the garments explicitly mentioned, including dress guidance that also mentions office hours. Clock hands and time labels use stated source times, including AM/PM and a.m./p.m. spellings. Illustrations do not mark garments as approved or tasks as completed.

Replies without linked company passages stay whole and are labelled as replies rather than illustrated policy instructions. Source passages remain in the chat's expandable **Company sources** section. Pictures have equivalent HTML topic labels and guidance; controls work by keyboard. There are no timers, automatic step advances or extra animations.

Selecting parts and opening the full wording are local reading controls. They do not mark tasks complete, measure understanding, change the employee summary or contact HR.

## Live support summary

Employee chat has no onboarding report, Privacy & sharing menu or report download. Recorded support continues to update after successful answers and explicit feedback, following the existing recording preference. Removing the menu does not turn paused collection back on. Employee-facing APIs omit aggregate summaries; `/api/employee-support-summary` returns `403 HR_ACCESS_REQUIRED`, including for an unverified HR guest.

The HR page at `/hr` (also `/hr-preview`) presents a document library, a team overview and separate live guest summaries. It fetches the current browser’s isolated employee reports and uploads; no existing private employee report API is opened. Alya reads the configured company Drive guidance as well as the workspace uploads. See [Account and workspace details](account-access.md) for the complete flow, retention, limits and authentication boundary.

The summary contains:

- Recorded answer and conversation counts.
- Delivered formats: short explanations, steps, examples and brief answers. Automatic support selects among these formats; a delivered format is not proof of an employee preference.
- Direct requests for steps, examples or brief explanations.
- Sourced visual-guide counts, helpful/unclear feedback and requests for human support. Guide counts retain the existing recorded short, source-supported answers; replies without company sources are not included. The Voice started box and voice statistics in reports have been removed; the current chat no longer submits voice-start telemetry.
- A recorded time period and a three-part employee overview: how the employee uses support, what HR can offer, and the next check-in.

Descriptions are deterministic templates based on counts, with no extra Gemini call. Recommendations use explicit support requests and feedback rather than automatically delivered formats. Fewer than three recorded answers is labelled an early summary. The report never diagnoses disability or estimates intelligence, learning speed, personality, understanding, task completion or job suitability.

Only new interactions are counted. Existing transcripts are preserved and not analysed retrospectively. Failed/cancelled answers and idempotent retries do not add another recorded answer. Historical voice events remain compatible with the store, but are not collected by the current interface or shown in the report. Ratings can be corrected without accumulating duplicate votes.

Existing collection preferences and observations are preserved. The retained settings API accepts only a boolean recording preference and returns only that setting. Deleting a saved conversation removes its observations. The existing 30-day retention and ownership checks apply.

## Report for HR

The HR workspace shows actual guest activity, explicit requests, feedback, a recommended check-in and practical support suggestions. HR can read and download the automatic summary. There is no HR-authored report form. The fictional example employees were removed. Guest reports belong to that browser’s workspace. Selecting HR does not grant access to existing employee reports; workforce reporting still requires verified identity, company membership and HR permissions. No external delivery occurs. Raw questions, transcripts and document passages are not part of the aggregate report.

## Shared voice

Heart is the fixed Kokoro English voice (`af_heart`), not a heart/reaction button. Everyone hears the same server-generated voice. Slower/Natural/Faster changes synthesis speed for the next answer. Reduce avatar movement calms body and head motion while retaining lip movement. Mute and Stop remain available.

The installed voice model warms at server startup with a discarded greeting through the normal synthesis queue. Warmup never plays audio, downloads a model or blocks website startup. Set `VOICE_WARMUP=false` to disable it. Missing models still produce the existing setup guidance. The first spoken segment now stops at a short sentence or approximately 105 characters; later segments remain longer and prefetch during playback. All spoken wording remains in order. Speech still waits for the written answer; CPU speed and concurrent requests affect delay.

## Implementation and verification

- `server/answer-guide-metadata.mjs`: retained source-supported answer metadata and guide-count compatibility for saved chats.
- `server/employee-support-tracking.mjs`: bounded interaction events, aggregate counts and summary templates.
- `server/saved-conversations.mjs`: support-event migration, ownership, retention and transactional writes alongside existing chats.
- `src/avatar/VisualAnswerPanel.jsx`: separate visual workspace, loading state and answer selection.
- `src/avatar/IllustratedAnswer.jsx`: numbered section selection, fitted reading pages, focused illustration, full-answer dialog and keyboard controls.
- `src/avatar/use-visual-text-pages.js`: measures paragraph space on resize, font loading and view changes.
- `src/avatar/visual-text-pagination.mjs`: preserves word order, keeps clock labels and short restriction phrases together, and restores the reading anchor after resizing.
- `src/avatar/alya-workspace.css`: window-sized layout with a larger avatar, manual view tabs and a Chat-only question form.
- `src/avatar/AnswerIllustrations.jsx`: original SVG subject illustrations; no stock graphics or invented application screenshots.
- `src/avatar/visual-answer-content.mjs`: source-based subject selection, conservative plain-wording rewrites and exact time/garment extraction, without new model calls or company facts.
- `src/avatar/visual-answer.css`: responsive visual theme and focus indicators. The obsolete `AnswerCard.jsx` and its styles were removed.
- `src/avatar/answer-support-controls.css`: feedback, source and explanation control styling; obsolete employee report components and styles are removed.
- `src/access/HrWorkspace.jsx`: automatic employee summaries.
- `src/access/hr-report-insights.mjs`: team counts and explicit activity labels.
- `src/access/CompanyDocumentLibrary.jsx`: uploads and connected Drive guidance.
- `src/avatar/hr-support-report.mjs`: concise HR report text.
- `tests/employee-support-tracking.test.mjs`: source consistency, retries, aggregation, pause, corrections, deletion, ownership and cross-origin checks.
- `tests/visual-answer-content.test.mjs`: complete wording/conditions, decimal values, numbered facts, bounded structure and unsourced replies.

The current workspace passes 72 tests and the production build. Browser checks at 1280×720, 900×768, 390×844 and 390×740 verified no guide or page overflow for the saved company answers. A longer Friday-break section used three readable pages at the shorter phone size; their combined wording exactly matched the delivered section, including both times and employee groups. Switching views retained the reading page and draft; the question box was hidden in Visual guide, and the Full answer dialog closed with Escape. No new Gemini call or employee feedback was submitted for these checks. Reading navigation does not record employee observations.

Inside UniVRse and Launchpad page components, navigation entries, search entries and unused styles were removed. Their old URLs redirect to Alya. Company/tool checklist actions now lead to the chat.
