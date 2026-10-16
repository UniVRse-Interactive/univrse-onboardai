# Alya: visual answers and onboarding support summary

## Try the first version

Open `/mira`. Ask a company or onboarding question, for example “How do I prepare for an internal meeting? Explain it step by step.”

- On desktop, a shared presentation stage occupies roughly 70% of the workspace; chat occupies 30%. Alya stays prominent in the centre as the spoken illustrations appear around her. The question box stays at the bottom of chat, with the transcript scrolling independently. Smaller laptops stack the scene above chat; phones and highly zoomed screens allow page scrolling to keep text and controls reachable.
- A new answer automatically brings its illustrated guide beside Alya. There are no Chat/Visual tabs or scroll-to-guide actions. The **Guide** selector reopens earlier answers without speaking them automatically. New chat restores Alya’s welcome scene; request failures show a retry message rather than presenting an older guide as the new answer.
- The visual uses one stable topic heading, such as **Office attire** or **Working hours**, throughout the explanation. The question is not repeated above it, and sentences are not reused as long headings. The body carries the explanation while the heading identifies its subject.
- The default answer is three complete sentences, usually 40–65 words when the source supports that detail. It leads with the exact answer, then a useful explanation and a relevant condition or next action. Specific permission questions lead with the matching source rule rather than a generic introduction. The formatter uses fewer sentences when there is less evidence and removes repeats instead of adding filler. **Keep it brief** still gives at most two sentences. Chat, speech and guide cues share exactly the same visible reply. **Full answer & conditions** retains complete source wording; long conditions are not cut mid-sentence.
- The guide follows the supplied reference video's presentation: Alya stays central, while one illustration and its short source-based caption appear beside her. Spoken points alternate sides on desktop; narrow screens keep the caption consistently beside Alya. A small navigation dock retains point selection, reading pace and replay. Restrictions have a written **Important detail** label as well as a visual accent. Captions fit without internal scrolling; Back/Next also handles fitted reading pages. Reading or navigating points does not record employee observations or completion. Reduced movement disables entrance animation and automatic following.
- **Clothing questions now use an automatic explainer sequence instead of that reading guide.** Transparent garment SVGs and short labels cross-fade directly beside Alya, without cards, borders, an infographic panel, numbered points or advance buttons. Each scene maps to a sentence in the exact spoken reply; illustrations are selected from the garments actually mentioned. Smart/business casual and neat clothing use a clearly illustrative outfit. Prohibition labels retain weekday qualifiers, and no garment is marked approved solely because it is pictured. Unrelated questions keep their existing non-clothing guide.
- The clothing sequence reads `getProgress()` from the existing AudioContext playback clock in an animation frame loop. No independent slideshow timer controls scene changes. Buffering holds the last scene, non-clothing spoken segments hide garments, and completion, mute, stop or playback failure fades all visuals away. New questions stop existing audio and unmount its sequence; replay starts from the beginning. Reduced movement disables visual transitions while allowing the spoken subject to update automatically. The response duration follows real audio (often 10–25 seconds for short answers), not a forced runtime. Character timing is estimated from actual chunk duration and word schedules, not phoneme-level forced alignment.
- Source-search follow-ups such as **What about Friday?** resolve the previous subject, while named new topics remain independent. Search recognises clothing spellings and meeting-preparation language. Employee preparation prefers explicitly labelled participant duties over host instructions, and incomplete table introductions are not presented as complete advice. These are conservative retrieval/presentation rules; live Gemini reasoning still requires a configured Vertex AI project and access.
- **Follow Alya** changes the displayed subject and fitted reading page using the current audio playback clock and the estimated word schedule. Buffering, muted audio and stopped playback do not advance the guide. This is approximate word alignment, not a forced-alignment speech service. The final guide stays visible after speech. **Listen again** replays exactly the visible chat reply without another chat/model request or reading the complete source answer.
- Select **Read at my pace** by turning off Follow Alya to keep the guide still while audio continues. Previous/Next also turn off following and allow reading every section and page manually. Reduced movement, including the operating system preference, starts the guide in this reading mode and removes scene transitions. Following can be explicitly re-enabled. These controls never mark onboarding tasks complete.
- Open Need another explanation? for Smaller steps, Show example and Keep it brief. These controls set the corresponding answer style and ask a follow-up about that answer's question. The five styles remain available in Answer style.
- The explanation controls are available in both Gemini and document-search workspaces. Smaller steps shows the explanation as numbered points. Search follow-ups reuse the original question, and a new subject remains a new search. Source search uses examples actually present in the guidance; when no example is supplied it says so. That request still appears in HR’s request count, but is not counted as a delivered worked example. Configured Gemini can generate a clearly labelled fictional example using the company guidance.
- Helpful / Still unclear feedback is saved per answer. Selecting an existing rating removes it; changing a rating replaces it.
- I need a person saves a support request in the conversation and shows a route to the support directory. It does not contact HR.
- Automatic voice, mute, stop and speed controls remain. Voice settings include reduced movement; the avatar stays visible and retains speech mouth movement.

The presentation uses the delivered answer without an additional model call. Original SVG illustrations sit on a muted slate and aqua reading surface. Narrow grammatical rewrites simplify recognised phrases; other wording, conditions and exceptions stay intact. Each reading page has at most 36 words and fits its available space without an internal scrollbar. Voice reads the same wording shown in the guide. The original written answer and company sources remain available in chat. Clothing pictures depict garments explicitly mentioned; clock labels use stated source times. Illustrations do not mark garments as approved or tasks as completed.

Replies without linked company passages stay labelled as conversation rather than confirmed policy. Pictures have equivalent HTML topic labels and guidance; controls work by keyboard. Guide progress is tied to playback, not an independent slideshow timer, and never measures employee progress or understanding.

Reading navigation, following and replay are local presentation controls. They do not mark tasks complete, measure understanding, change the employee summary or contact HR.

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
- `src/avatar/AlyaPresentationStage.jsx`: shared avatar scene, answer selection, illustrated guide, playback following, reading controls and reduced movement.
- `src/avatar/clothing-presentation.mjs`: clothing-topic gate, source-text garment selection and spoken-character scene boundaries.
- `src/avatar/ClothingPresentation.jsx`: playback-led scene switching, ending, interruption cleanup and replay.
- `src/avatar/ClothingIllustration.jsx` and `clothing-presentation.css`: transparent garment drawings and restrained cross-fades around the existing avatar.
- `src/avatar/presentation-cues.mjs`: maps spoken characters back to original answer sections, retaining original wording and conditions.
- `src/avatar/answer-audio-player.js`: cancellation-safe audio queue, mouth frames and progress from the actual audio clock.
- `src/avatar/use-visual-text-pages.js`: measures paragraph space on resize, font loading and view changes.
- `src/avatar/visual-text-pagination.mjs`: preserves word order, keeps clock labels and short restriction phrases together, and restores the reading anchor after resizing.
- `src/avatar/alya-presentation.css`: shared stage, 70/30 desktop layout, fixed chat composer and responsive reading surfaces; extends the existing workspace styles.
- `src/avatar/chat-answer-presentation.mjs`: common visible reply and identical speech text for every answer mode, with the full original retained separately.
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

The combined-scene update is covered by automated tests, formatting and the production build. The installed Windows voice integration test is excluded in this environment; voice playback was also checked in the browser. Browser checks cover the shared scene, automatic guide appearance, playback progression, read-at-my-pace, reduced movement and access to full conditions. Cross-topic tests cover dress, working hours, meetings, leave, account access and unsourced/generated replies, checking that the fuller visible explanation exactly matches speech and guide cues. Short or highly zoomed viewports permit page scrolling to keep controls reachable. Reading navigation and replay do not record employee observations. This design has not yet been validated in usability sessions with neurodivergent employees.

Inside UniVRse and Launchpad page components, navigation entries, search entries and unused styles were removed. Their old URLs redirect to Alya. Company/tool checklist actions now lead to the chat.
