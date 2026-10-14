# Adaptive answers with Alya

## Open company and onboarding chat

Employees can ask their own questions about UniVRse and onboarding tasks. There is no fixed topic menu, lesson stage, practice quiz or chat completion checklist. Gemini interprets each current question and follow-up, then retrieves evidence from the existing connected Drive documents. A new subject takes priority over an older lesson in the saved transcript.

Company answers must cite retrieved passages. If the documents do not establish an answer, Alya explains the gap and suggests confirming with HR. Open questions do not give the model permission to invent company policies or reveal private employee records.

## Answer style

Open /mira, type a question and send it. Choose **Answer style** beside Saved chats to see the current explanation format and its reason, select a fixed format or reset the style.

| Request or setting                                          | Presentation                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| Standard                                                    | Two or three short sentences                               |
| “I do not understand” or “Break it down”                    | At most three short numbered steps                         |
| “Give me an example”                                        | Short explanation and a fictional worked example           |
| “Keep it short”                                             | One or two short sentences, retaining necessary conditions |
| Three consecutive recognised queries about the same subject | Smaller steps with the reason shown                        |
| “I understand now”                                          | Standard explanation when automatic support is selected    |

A manually selected format takes priority until changed. English and selected Malay requests are recognised; some paraphrases may not trigger a change. Internal subject hints help detect repeated questions only; they never restrict retrieval or the questions employees can ask.

Support changes the explanation, not policy access. Alya does not infer autism, neurodivergence, disability, intelligence or learning speed. Spelling, grammar, response time, identity and diagnoses do not select a path. There are no medical labels or ability scores.

## Saved conversations

The answer preference, current format and reason are saved per conversation. Reopening restores them; a new chat has fresh settings. Resetting the answer style retains chat history. Existing ownership checks and 30-day retention still apply.

Old lesson state is discarded when read, while past messages remain available. Requests from an outdated interface to start, advance or finish a guided topic are rejected before any model call. The settings endpoint accepts only presentation preference and reset controls.

## Implementation

- server/answer-style-preferences.mjs: presentation preferences, direct support requests and repetition hints.
- server/gemini-chat-workflow.mjs: interpret the current question, adapt its presentation, retrieve company evidence and answer with citations.
- server/api-routes.mjs: owner-checked settings endpoint; no topic list in configuration.
- src/avatar/AnswerStyleSettings.jsx: answer style selector, reason and reset.
- src/avatar/AlyaChatPage.jsx: open question input, saved conversations, sources and automatic voice.
- tests/answer-style-preferences.test.mjs: unrestricted questions after old lessons, preserved history, removed action rejection and presentation safeguards.

## Verification

Run `npm test` and `npm run build` to check the project. Tests use synthetic documents and injected model responses; they check routing, persistence, source requirements and settings, not every real policy answer. Browser-session ownership is not employee sign-in.
