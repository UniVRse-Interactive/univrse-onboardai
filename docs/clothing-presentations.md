# Automatic clothing presentations

Office clothing answers now play as a short presentation around the existing Alya avatar. Chat stays on the right on desktop; on phones it stacks below the stage. No scene selection or image clicks are needed.

## Changed files

- `src/avatar/AlyaChatPage.jsx`: passes matching clothing segments to automatic speech and replay.
- `src/avatar/answer-audio-player.js`: validates optional scene segments against the actual spoken answer, then generates and prefetches their audio using the existing Kokoro voice.
- `src/avatar/clothing-presentation.mjs`: builds reusable scenes with exact spoken character boundaries, garment choices, restrictions, conditions and deliberate visual gaps. Contrasting clauses are separated; source text and company restrictions are retained.
- `src/avatar/ClothingPresentation.jsx`: presents scene titles, transparent garment illustrations on both sides of the presenter, subtitles and a noninteractive sequence indicator. Cleans up its animation frame when stopped, replaced or unmounted.
- `src/avatar/ClothingIllustration.jsx`: local vector wardrobe illustrations with fabric shading, tailoring details and avoid indicators. No image download or new dependency is required.
- `src/avatar/clothing-presentation.css`: automatic fades, gentle movement, open composition, reduced-motion support and responsive layouts.
- `tests/clothing-presentation.test.mjs`, `tests/answer-audio-player.test.mjs`: scene content, restrictions, exact audio boundaries, buffering, interruption and stale-segment protection.
- `scripts/preview-clothing-presentation.mjs`: isolated browser QA with clearly labelled sample answers, the actual app build, avatar and real Kokoro voice. It does not load `.env`, contact Vertex AI or open saved conversations.

## Speech synchronization

The same short answer is used in chat, speech and scenes. Scene text is sent as explicit speech segments after validating that it reconstructs the answer exactly. Each scene therefore starts on the corresponding AudioBufferSource playback boundary. The player still prefetches the next chunk while the current one plays.

The presentation reads `getProgress()` on animation frames. That progress uses AudioContext.currentTime and a word schedule scaled to each decoded audio buffer's actual duration. Buffering does not advance the sequence. New questions, stop, mute, voice failure and navigation clear playback through the existing generation token and abort handling. Scenes fade out when speech ends and are never shown as a static gallery.

Kokoro currently returns WAV audio without word timestamps. Within a scene, word positions and mouth movement remain estimates scaled to real audio duration. The scene boundaries are audio aligned, but seamless playback can still depend on how quickly the next segment synthesizes. There is no added external AI service or fallback slideshow.

## Validation

All 138 automated tests and the production build pass. Changed-file formatting and `git diff --check` pass. Browser QA uses sample responses because the currently running company chat reports missing Vertex AI project configuration. It exercises the actual bundled React interface, supplied avatar and real Kokoro audio, rather than simulated playback.

Browser cases: office clothing, first-day clothing, business casual, clothing to avoid, conditional jeans guidance, unrelated working-hours question, interruption during speech, automatic scene changes and end-of-speech clearing. Desktop (1440 × 900), phone (390 × 844) and narrow phone (320 × 568) layouts are inspected, including the composer and separation between clothing artwork and the avatar. Short phones can scroll to the composer without horizontal overflow. Loading leaves the illustrations hidden until audio starts. Inline SVG eliminates remote image-loading failures. The QA browser reported no console errors.

Run the isolated preview:

```powershell
npm.cmd run build
node scripts/preview-clothing-presentation.mjs
```

Open http://localhost:3001/mira. Responses there are samples for visual testing, not company policies. The normal configured app remains at http://localhost:3000/mira.

## Expanded onboarding support

The automatic player now covers every onboarding answer. See [Automatic onboarding presentations](onboarding-presentations.md) for the current shared player, caption handling, file list and verification. Clothing keeps its specialized artwork within that shared player. The original clothing preview command now opens the expanded sample preview.
