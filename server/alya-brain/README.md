# ALYA — answering brain only

This is the current OnboardAi answering logic extracted into a stateless Node.js module. No UI, avatar, speech, HTTP server, authentication, database, chat history, employee profile, HR report or private company documents are included. The original application is unchanged.

## What “trained to answer” means here

The inspected project configures Gemini through prompts and retrieves approved company-document passages. It does not contain a fine-tuned model or exported model weights. This package preserves its concise, respectful answer instructions, source-only company facts, HR fallback, citation validation, question interpretation, and explicit requests for brief answers, smaller steps and fictional examples. It does not transfer learned employee preferences or prior conversations.

Each call is independent. “What about that?” needs clarification because no previous question is retained. Explicit preferences must be included in the current question. There is no saved history, disk persistence or user-data logging in this module. The retriever caches only company-document chunks in process memory and refreshes when the supplied documents change. Use one brain instance per company/document access scope.

## Use from your backend

Node.js 22+ is required. Run `npm install` inside this folder. Direct dependencies are pinned to versions in the source project's lockfile; a separate transitive lockfile is not included. Create and commit your own package lock after installation for repeatable deployments.

```js
import { createBrain } from './server/brain.mjs';

const brain = createBrain({
  env: {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
  },
  loadDocuments: async () => [
    { title: 'Your approved handbook', text: 'Your actual approved guidance here.' },
  ],
});

const result = await brain.ask('What can I wear to the office? Keep it brief.');
console.log(result.answer);
console.log(result.passages); // Supporting document titles, headings and text.
```

Connect `loadDocuments` to your own approved files, Google Drive loader, or document service. This package includes retrieval/ranking, not the original Drive credentials or connector. Return `{ title, text }` documents. Authorize document access and enforce file/type/size limits in your application before calling the loader. No private documents were copied.

Copy `.env.example` to `.env`, configure your own Gemini key/model, and run `npm run example` for a CLI example. Only that example loads `.env`; an integrating application must load its own environment. The example document is illustrative, not actual company policy. Never use the key in browser code.

Gemini requires network access, model availability and applicable API billing/quota. Questions and selected passages are sent to the configured Gemini service. There is no provider fallback. The default model name is retained from the source; select a model your account can access.

## Files

- `server/brain.mjs`: Gemini interpretation and answer prompts, stateless workflow, source validation, request cancellation and a default 45-second timeout (configurable up to 120 seconds).
- `server/company-document-retriever.mjs`, `server/document-search.mjs`: original passage splitting and ranked retrieval.
- `server/answer-style-preferences.mjs`: original explanation-style rules, evaluated fresh for each question; no persistence.
- `shared/clothing-guide.mjs`: clothing intent and concise-answer rules only; no visual assets.
- `tests/brain.test.mjs`: isolated tests without paid API calls.

## Reliability and limits

Run `npm test`. Tests cover supported citations, missing evidence, malformed citation rejection, independent/concurrent requests, cancellation, missing configuration, input validation, sanitized errors and real local retrieval with test documents. The six tests passed using the installed source-project dependencies. Live Gemini calls and a fresh network dependency installation were not performed for this export.

Output is generative, not deterministic. Valid citation IDs do not prove every sentence is factually entailed; human policy review is still necessary. Missing guidance returns an honest HR fallback. Provider failures throw a sanitized error for your application's retry/error UI to handle. There is no claim of perfect reliability or additional model training.
