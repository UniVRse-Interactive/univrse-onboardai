# Automatic onboarding presentations

Every nonempty assistant answer now uses an automatic, speech-led presentation around Alya. The previous manual Next/Back guide has been removed from the live stage. Desktop chat remains on the right; phone chat remains below the presenter.

## Files changed

- `src/avatar/answer-presentation.mjs`: shared scene builder and audio-character lookup. It selects artwork from the current spoken sentence, preserves exact text and timing offsets, retains the specialized clothing scenes, and supplies general guidance artwork for unfamiliar topics.
- `src/avatar/AutomaticPresentation.jsx`: shared playback follower, automatic scene transitions, sequence indicator, end-of-speech clearing and optional replay. There are no manual scene controls.
- `src/avatar/AutomaticCaption.jsx`: measured captions that advance through long sentences using actual spoken progress. This reuses the existing text pagination utilities without rewriting or dropping conditions.
- `src/avatar/OnboardingIllustration.jsx`: transparent illustrations for clocks, leave calendars, arrival, task lists, approvals, safety, pay and company information; reuses existing artwork for documents, IT, meetings and people.
- `src/avatar/ClothingPresentation.jsx`: clothing scene rendering now uses the shared player and captions.
- `src/avatar/automatic-presentation.css`, `src/avatar/clothing-presentation.css`: shared open-stage layout, fades, gentle movement, bounded captions and responsive styling. Reduced motion disables animation while scenes continue following audio; static SVG transforms are preserved.
- `src/avatar/AlyaPresentationStage.jsx`: routes all answer topics into the shared automatic player.
- `src/avatar/AlyaChatPage.jsx`: passes matching spoken segments for every new answer and replay; updates the reduced-motion settings text.
- `tests/answer-presentation.test.mjs`, `tests/answer-audio-player.test.mjs`: topic selection, source preservation, exact timing boundaries, 12/24-hour clocks, conditional leave guidance, unknown policies, cancellation and voice failure.
- `scripts/preview-onboarding-presentation.mjs`: isolated sample preview with the actual bundled application, supplied avatar and real Kokoro voice. The previous clothing preview command forwards to this script.

## Synchronization

Chat, voice and visual scenes share the existing concise answer. Spoken sentence segments are validated against the complete answer before synthesis. Each scene begins with its corresponding decoded audio segment, and the next segment is prefetched during playback.

The player reads AudioContext.currentTime through the existing getProgress() method. Scenes and caption pages follow that progress on animation frames. Buffering holds the current scene without advancing an independent timer. Stop, mute, a new question, navigation and failures clear the sequence using the existing speech generation token and abort controller.

Kokoro supplies WAV audio without word timestamps. Sentence/scene boundaries align with actual playback; word positions, mouth movement and caption-page timing within each segment remain estimates scaled to the decoded audio duration. Slow synthesis can still create a brief gap between segments.

## Content handling

Working hours show literal times from the spoken answer. No schedule, time range, leave entitlement, date, address, completion state or approval is invented by the visuals. Unknown-policy replies use neutral document/support artwork. Other onboarding subjects fall back to a general guidance illustration when there is no dedicated topic match. Specialized clothing graphics remain available.

## Verification

- All 146 automated tests pass.
- Production build, changed-file formatting and git diff --check pass.
- Browser checks use the real avatar and Kokoro audio with explicitly labelled sample answers for working hours, leave and first-day tasks.
- Hours-to-leave interruption clears the previous sequence. End of speech clears the visual scenes.
- Phone layout checked at 390 × 844: no horizontal overflow; composer visible; captions remain below the presenter.
- Reduced-motion playback verified advancing from regular hours to lunch automatically while animations stay disabled and static clock hand positions remain correct.

The configured company chat still reports missing Vertex AI project configuration. Sample QA does not load .env, read saved conversations or contact Vertex AI, so it verifies presentation behavior without pretending to validate the live company answer service.

## Run the sample preview

```powershell
npm.cmd run build
node scripts/preview-onboarding-presentation.mjs
```

Open http://localhost:3001/mira. The normal configured application remains at http://localhost:3000/mira. Preview answers are samples, not company policies.
