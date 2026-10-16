# Alya: visual answers and onboarding support summary

## Try the first version

Open `/alya`. Ask a company or onboarding question, for example “How do I prepare for an internal meeting? Explain it step by step.”

- Alya stands on her presentation stage with the chat beside it (issue #61, ported from PR #59). When an answer arrives she speaks it, and the stage shows it as a visual guide: a short answer built from the answer's own sentences, then one scene per sentence (dress-code garments, working hours, leave, first-day arrival, security and other onboarding subjects, with original SVG illustrations). The scenes and their captions follow her voice: the audio player reports the spoken position, so a scene changes when the audio reaches it.
- With voice off, unavailable or finished, the employee steps through the same scenes with **Previous** and **Next** at their own pace; **Listen again** replays the answer. Captions are paged to fit the space without dropping words. When a chat has several answers, the **Guide** selector chooses which one is illustrated.
- Everything on the stage is worked out in the browser from the delivered answer text and its sources. There is no extra model call, and no new company facts, times, garments or approvals are invented. #59's server-side answering "brain" was not adopted. Illustrations show the subject, never a task's completion or approval. Reduced motion (the setting or the system preference) calms the stage.
- Open Need another explanation? for Smaller steps, Show example and Keep it brief. These controls set the corresponding answer style and ask a follow-up about that answer's question; the follow-up turn names the answer it re-explains (`reexplainOf`). The five styles remain available in Answer style. The Keep it brief text ("Please keep the answer brief …") counts as a brief request in the support observations.
- Helpful / Still unclear feedback is saved per answer. Selecting an existing rating removes it; changing a rating replaces it.
- I need a person records a help observation on the answer. For signed-in employees it opens the consented Ask HR flow: a preview of exactly what HR will see (the question, Alya's answer and its sources), an optional note and a confirmation. Only a confirmed request reaches HR (see [Onboarding journey and support](onboarding-journey.md#support-requests-d1-option-a)).
- Per-answer Read aloud controls have been removed. Automatic voice, mute, stop and speed controls remain. Reduce avatar movement is available in voice settings; the avatar stays visible and retains speech mouth movement.

The stage uses the delivered answer rather than asking Gemini to generate another summary, and the full answer stays in the chat beside it. Source passages remain in the chat's expandable **Company sources** section. Dress-code scenes depict only the garments the answer mentions and keep what is allowed apart from what to avoid; conditions such as "only", "unless" and "weekdays" stay with the sentence they qualify. Clock hands and time labels use the times the answer states. Illustrations do not mark garments as approved or tasks as completed.

Stepping through the guide and replaying it are local reading controls: they do not record employee observations, mark tasks complete, measure understanding or contact HR.

## Support observations and what HR sees (D1 Option A)

Employee chat has no onboarding report, Privacy & sharing menu or report download. Recorded support observations (delivered formats, explicit requests, feedback and help requests) continue to update after successful answers and explicit feedback, following the existing recording preference (`POST /api/support-summary/settings`). Employee-facing APIs omit aggregate summaries; `/api/employee-support-summary` returns `403 HR_ACCESS_REQUIRED` for every account.

Decision D1 = Option A (issue #48, consent-based): HR sees an individual's struggles only when that employee confirms a support request. The automatic named per-employee summaries and `GET /api/hr/support-summaries` were removed. Signed-in HR sees instead:

- **Support requests**: the requests employees confirmed, by name, with the question, Alya's answer and its sources, worked through Open, Briefing scheduled and Resolved.
- **Team insights** (`GET /api/hr/team-insights`): the observations summed over every employee (answers, feedback, delivered formats, explicit requests, help requests and the period as calendar days), shown only when at least 3 employees have recorded activity. With fewer, it says there is not enough data yet.
- **Knowledge gaps**: anonymous onboarding questions the documents could not answer, grouped by topic.

The aggregates are deterministic sums with no extra Gemini call. They never diagnose disability or estimate intelligence, learning speed, personality, understanding, task completion or job suitability, and they never change onboarding completion. Only new interactions are counted; failed or cancelled answers and idempotent retries add nothing; ratings can be corrected without duplicate votes; deleting a saved conversation removes its observations. The existing 30-day retention and ownership checks apply. Raw questions, transcripts and document passages are never part of team insights.

The guest workspace with its browser-scoped HR page and guest reports was removed (issue #55).

## Shared voice

Heart is the fixed Kokoro English voice (`af_heart`), not a heart/reaction button. Everyone hears the same server-generated voice. That is the default; with `VOICE_PROVIDER=gemini` the server speaks with Gemini text to speech (default voice Sulafat) and falls back to Kokoro (see [Alya's voice](onboarding-journey.md#alyas-voice-gemini-text-to-speech-52)). Slower/Natural/Faster changes Kokoro's synthesis speed for the next answer; a Gemini clip keeps Gemini's natural pace (the prompt is the sentence alone, see the link above). Reduce avatar movement calms body and head motion while retaining lip movement. Mute and Stop remain available.

The installed voice model warms at server startup with a discarded greeting through the normal synthesis queue. Warmup never plays audio, downloads a model or blocks website startup. Set `VOICE_WARMUP=false` to disable it. Missing models still produce the existing setup guidance. The first spoken segment now stops at a short sentence or approximately 105 characters; later segments remain longer and prefetch during playback. All spoken wording remains in order. Speech still waits for the written answer; CPU speed and concurrent requests affect delay.

## Implementation and verification

- `server/answer-guide-metadata.mjs`: retained source-supported answer metadata and guide-count compatibility for saved chats.
- `server/employee-support-tracking.mjs`: bounded interaction events, aggregate counts and summary templates.
- `server/saved-conversations.mjs` (SQLite) and `server/firestore-chat-memory.mjs` (Firestore): support observations, ownership, retention and transactional writes alongside existing chats.
- `src/avatar/AlyaPresentationStage.jsx`, `AutomaticPresentation.jsx`, `AutomaticCaption.jsx`: Alya's stage, the scenes that follow her voice or the reader's steps, and the paged captions (see [File guide](file-guide.md#alyas-presentation-stage-issue-61) for every stage file).
- `src/avatar/answer-presentation.mjs`, `short-answer.mjs`, `clothing-presentation.mjs`, `presentation-cues.mjs`, `scene-steps.mjs`: the short answer and the scenes built from the delivered answer, and how they follow the audio.
- `src/avatar/use-visual-text-pages.js`: measures caption space on resize, font loading and layout changes.
- `src/avatar/visual-text-pagination.mjs`: preserves word order, keeps clock labels and short restriction phrases together, and restores the reading anchor after resizing.
- `src/avatar/alya-workspace.css`, `alya-presentation.css`, `automatic-presentation.css`, `clothing-presentation.css`: the window-sized layout with the stage and the chat, and the scene styling.
- `src/avatar/AnswerIllustrations.jsx`, `OnboardingIllustration.jsx`, `ClothingIllustration.jsx`: original SVG illustrations; no stock graphics or invented application screenshots.
- `src/avatar/visual-answer-content.mjs`: topic titles, point labels and conservative plain wording from the delivered answer, without new model calls or company facts.
- The separate visual panel (`VisualAnswerPanel.jsx`, `IllustratedAnswer.jsx`, `visual-answer.css`) and the manual Chat / Visual guide tabs were removed in #61.
- `src/avatar/answer-support-controls.css`: feedback, source and explanation control styling; obsolete employee report components and styles are removed.
- `server/team-insights.mjs`, `server/support-requests.mjs`: team-level insights and consented support requests.
- `src/access/`: the HR workspace screens (frontend; see [File guide](file-guide.md)).
- `tests/employee-support-tracking.test.mjs`: source consistency, retries, aggregation, pause, corrections, deletion, ownership and cross-origin checks.
- `tests/visual-answer-content.test.mjs`: complete wording/conditions, decimal values, numbered facts, bounded structure, unsourced replies, topic titles and point labels.
- `tests/answer-audio-player.test.mjs`: spoken progress across audio chunks, and scene changes at real audio boundaries (clothing, hours, leave and first-day scenes), reset after an interruption.

Inside UniVRse and Launchpad page components, navigation entries, search entries and unused styles were removed. Their old URLs redirect to Alya. Company/tool checklist actions now lead to the chat.
