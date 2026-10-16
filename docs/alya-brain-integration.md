# Supplied ALYA brain integration

The active local application uses `AI_MODE=alya-brain`. It calls the answering module supplied in `C:\Users\User\OneDrive\Documents\ALYA-brain-only\alya-brain` through both the main chat and employee-workspace chat routes.

## Source package

`server/alya-brain/` contains exact copies of the supplied answering code, shared clothing instructions, package metadata, README and tests. `source-hashes.json` records SHA-256 hashes; an automated test checks that the copied files are unchanged. The original folder was not modified. Existing installed LangChain dependencies satisfy the package; no new service or dependency was added.

The package is a stateless Gemini workflow, not model weights. It interprets each current question, retrieves approved document passages, generates a concise answer and validates citation IDs. It uses the server-only `GEMINI_API_KEY` and configured `GEMINI_MODEL` with the Gemini API. Google Drive access continues using its existing credentials. Vertex AI credentials are not required for this brain.

## Application adapter

`server/alya-brain-service.mjs` integrates the package without editing its prompts or retrieval logic. The adapter:

- Preserves saved chat transcripts, ownership checks, request deduplication, feedback and the existing support-report events.
- Gives each authorized conversation a separate brain/retrieval cache and loads only its permitted company documents. Guest guidance remains isolated by workspace. Document revisions and access are checked on new questions; revoked sources are not reused.
- Sends only the current question, with an explicitly selected answer-format setting when present. Saved messages, inferred learning patterns and HR reports are not sent to the brain.
- Retains the existing response structure needed by chat, speech and the automatic scene builder.
- Handles interruption, missing keys and provider/document failures without silently falling back to the previous answering engine.

The main and guest route configuration identifies `alya-brain`, package version `1.0.0` and `answerContext: stateless`. Older chats remain readable. Because the supplied module is stateless, ambiguous follow-ups can ask for clarification instead of recalling previous turns. Use a complete question, or the existing support controls that include the original question.

## Activation and checks

The local `.env` was changed only from its previous `AI_MODE` to `AI_MODE=alya-brain`; its existing key, model and Drive settings were retained. The previous mode is recorded in the ignored `.cache/brain-migration/previous-mode.json`. Credentials were not copied into source files or browser code. `.env.example` documents the new mode without including a real key.

```powershell
npm.cmd run check:gemini
npm.cmd test
npm.cmd run build
```

The connection check now tests the selected brain. In legacy Vertex mode it retains the previous Vertex check. `AI_MODE=gemini-chat` is retained as an explicit legacy option; the active local setting selects the supplied brain. Demo and document-search modes remain explicit options, not failure fallbacks from `alya-brain`.

## Verification

- All 160 tests pass, including the supplied package's six original tests.
- Integration tests cover both HTTP chat routes, per-workspace sources, stateless requests with retained transcripts, settings, citations, retries, ownership, revoked documents, interrupted answers and missing configuration.
- Production build succeeds; changed-file formatting and `git diff --check` pass.
- Live Gemini greeting succeeds using the existing server key and model.
- A live working-hours question in the actual application receives an answer from the connected company guidance. Existing saved history remains present. Avatar voice and synchronized scenes use that answer through the existing presentation path.

The package returns WAV-independent text and citations. Voice generation and within-segment timing limits are unchanged; see [automatic onboarding presentations](onboarding-presentations.md).
