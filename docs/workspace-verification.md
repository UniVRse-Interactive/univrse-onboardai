# Workspace change verification

Verified on 2026-10-15 with Node.js 23.11 on macOS.

- `npm test`: 86 tests, 85 passed, one Windows-only voice test skipped, no failures.
- `npm run build`: passed. Existing Three.js renderer chunk is 580 KB minified, above Vite's 500 KB advisory threshold.
- `npm run format:check`: passed.
- `npm run check:share`: passed; no recognised credentials or private-file patterns found. `.env` and local databases are ignored. The example environment has blank credentials and folder ID.
- `git diff --check`: passed.
- `npm run check:drive`: live public-folder read succeeded, three documents / 61,145 characters. No document text or credentials were printed.
- `npm run check:gemini`: live structured-output connection succeeded using the configured `gemini-3.5-flash-lite` model. No provider was switched.
- Running local HTTP smoke checks returned 200 for `/`, `/api/health`, `/api/access`, and the unchanged digital-human GLB endpoint. The model retains gzip delivery.

New tests exercise HR-only preview routes, browser workspace isolation, upload type/content/size validation, combined Drive/upload retrieval and removal, empty reports, explicit feedback, stable employee IDs after removal, and stale-tab ownership protection. Server-rendered markup tests check preview disclosures, manual reading controls, written instructions, Back/Next and full-answer access. Existing tests cover source constraints, follow-up memory, support signals, voice and avatar assets.

No browser was available through the connected browser runtime. Desktop/mobile screenshots, zoom behavior, keyboard interaction and live animation/audio playback were **not visually verified**. Server-rendered markup is not a substitute for browser interaction tests. Review the access page, employee dashboard, Ask Alya and HR workspace at desktop and narrow widths before accepting visual quality.

The feature branch also retains the existing uncommitted digital-human and public-Drive work so the reviewed checkout keeps the user's current avatar and integration. The avatar implementation/assets were not redesigned for this task. The unused portrait file remains local and is excluded from the commit. No production authentication, PDF/Word parsing, employee notifications or deployment is included.
