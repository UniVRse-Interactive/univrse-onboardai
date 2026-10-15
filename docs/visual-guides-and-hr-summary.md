# Alya: visual answers and onboarding support summary

## Try the first version

Open `/mira`. Ask a company or onboarding question, for example “How do I prepare for an internal meeting? Explain it step by step.”

- The chat shows text and speaks automatically when voice is on. The separate **A clearer picture** visual panel updates with each answer below the avatar/chat. **View visual** jumps to it; **Choose an answer** reopens answers from the current conversation.
- Explicit numbered actions appear as a connected row of illustrations. Company facts use illustrated subjects without process arrows. Select a picture or use Back/Next to read that part in **Visual view**. **All details** shows every part with its original wording. Numbered facts are not labelled as task flows.
- Open Need another explanation? for Smaller steps, Show example and Keep it brief. These controls set the corresponding answer style and ask a follow-up about that answer's question. The five styles remain available in Answer style.
- Helpful / Still unclear feedback is saved per answer. Selecting an existing rating removes it; changing a rating replaces it.
- I need a person saves a support request in the conversation and shows a route to the support directory. It does not contact HR.
- Per-answer Read aloud controls have been removed. Automatic voice, mute, stop and speed controls remain. Reduce avatar movement is available in voice settings; the avatar stays visible and retains speech mouth movement.

The visual panel uses the delivered answer rather than asking Gemini to generate another summary. It has original, scalable SVG illustrations on a light reading surface. Known verbose phrases can be shortened through narrow grammatical rewrites; conditions, exceptions, negatives and approval wording prevent those rewrites. **Original wording**, **All details** and **Full answer** preserve the complete delivered text. Policy terms such as “not allowed”, “only”, “unless” and “weekdays” receive visual emphasis without altering their wording. Clothing pictures depict the garments explicitly mentioned, and clock hands/times use stated source times. Illustrations do not mark garments as approved or tasks as completed.

Replies without linked company passages stay whole and are labelled as replies rather than illustrated policy instructions. Source passages remain in the chat's expandable **Company sources** section. Pictures have equivalent HTML topic labels and guidance; controls work by keyboard. There are no timers, automatic step advances or extra animations.

Selecting parts and changing the visual view are local reading controls. They do not mark tasks complete, measure understanding, change the employee summary or contact HR.

## Live support summary

Below the chat is **Your onboarding experience**. It updates across this browser session's saved conversations after a successful answer, feedback change or explicit request for human help.

The summary contains:

- Recorded answer and conversation counts.
- Delivered formats: short explanations, steps, examples and brief answers. Automatic support selects among these formats; a delivered format is not proof of an employee preference.
- Direct requests for steps, examples or brief explanations.
- Sourced visual-guide counts, helpful/unclear feedback and requests for human support. Guide counts retain the existing recorded short, source-supported answers; replies without company sources are not included. The Voice started box and voice statistics in reports have been removed; the current chat no longer submits voice-start telemetry.
- A recorded time period and a three-part employee overview: how the employee uses support, what HR can offer, and the next check-in.

Descriptions are deterministic templates based on counts, with no extra Gemini call. Recommendations use explicit support requests and feedback rather than automatically delivered formats. Fewer than three recorded answers is labelled an early summary. The report never diagnoses disability or estimates intelligence, learning speed, personality, understanding, task completion or job suitability.

Only new interactions are counted. Existing transcripts are preserved and not analysed retrospectively. Failed/cancelled answers and idempotent retries do not add another recorded answer. Historical voice events remain compatible with the store, but are not collected by the current interface or shown in the report. Ratings can be corrected without accumulating duplicate votes.

**Update from future interactions** pauses or resumes collection for this browser session. Existing observations remain in the summary. Deleting a saved conversation removes its associated observations. The existing 30-day conversation retention and ownership checks apply.

## Report for HR

Choose **Review employee summary**. The dialog previews the exact report, allows an optional employee-provided name, and requires an explicit review checkbox before download. It exports a concise fixed text-file snapshot with the employee interaction summary, practical HR support suggestions and a next check-in. Long repeated notices, raw questions, chat transcripts and document passages are omitted. Later conversations update the live summary, not a previously exported report.

The employee shares the downloaded report through the approved private HR channel. This preview has no HR inbox, company-wide analytics or authenticated manager access. Those require employee sign-in, role-based access and an agreed sharing process before rollout. Current ownership is a private browser-session cookie, not a verified employee identity.

## Implementation and verification

- `server/answer-guide-metadata.mjs`: retained source-supported answer metadata and guide-count compatibility for saved chats.
- `server/employee-support-tracking.mjs`: bounded interaction events, aggregate counts and summary templates.
- `server/saved-conversations.mjs` (SQLite) and `server/firestore-chat-memory.mjs` (Firestore): support observations, ownership, retention and transactional writes alongside existing chats.
- `src/avatar/VisualAnswerPanel.jsx`: separate visual workspace, loading state and answer selection.
- `src/avatar/IllustratedAnswer.jsx`: picture selection, short reading, original wording, All details and keyboard controls.
- `src/avatar/AnswerIllustrations.jsx`: original SVG subject illustrations; no stock graphics or invented application screenshots.
- `src/avatar/visual-answer-content.mjs`: source-based subject selection, conservative plain-wording rewrites and exact time/garment extraction, without new model calls or company facts.
- `src/avatar/visual-answer.css`: responsive visual theme and focus indicators. The obsolete `AnswerCard.jsx` and its styles were removed.
- `src/avatar/EmployeeSupportSummary.jsx`: employee overview, three statistics, collection controls and reviewed report export.
- `src/avatar/hr-support-report.mjs`: concise HR report text.
- `tests/employee-support-tracking.test.mjs`: source consistency, retries, aggregation, pause, corrections, deletion, ownership and cross-origin checks.
- `tests/visual-answer-content.test.mjs`: complete wording/conditions, decimal values, numbered facts, bounded structure and unsourced replies.

The illustrated-panel update passes 52 tests and the production build. A saved meeting answer was checked with keyboard picture selection, shorter wording, Original wording and All details. Desktop and narrow layouts were checked for page overflow. Earlier checks verified automatic panel updates with a fresh Gemini answer and voice, live employee-summary controls, HR report review and avatar/chat alignment. Picture navigation does not record employee observations. The temporary browser viewport override is reset after verification.

Inside UniVRse and Launchpad page components, navigation entries, search entries and unused styles were removed. Their old URLs redirect to Alya. Company/tool checklist actions now lead to the chat.
