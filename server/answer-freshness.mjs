// Stale company documents (issue #79). The answer prompt's recency rules let
// Gemini arbitrate between passages by their dates; when every passage that
// addresses the question is out of date, the model sets stale=true in its
// structured output. The server then discards the model's text and sends this
// fixed reply with the Ask HR offer (coverage none), as the no-source path
// does. Alya's wording is never parsed.
//
// The verdict is checked right after the answer is validated and before any
// other fallback (the zero-citation reply, coverage, the example opening), and
// it would come before #64's no_source and evaluator steps too: a stale answer
// has no citations, so those steps would otherwise swallow it.

export const staleReply =
  "The company documents I have on this are out of date, so I won't rely on them. Please check with HR for the latest guidance.";

export const freshnessVerdicts = Object.freeze(['stale']);

// 'stale' for a company answer the model marked stale, else null.
export function staleVerdictOf(planKind, output) {
  return planKind === 'company' && output?.stale === true ? 'stale' : null;
}

// The `guardrail` field of a turn a freshness verdict decided (a strict subset
// of #64's `guardrail: { verdict, askHr } | null`). A stale reply offers Ask HR.
export const guardrailFor = (verdict) => ({ verdict, askHr: true });

// { guardrail } of a saved assistant message (top level, or in its result)
// when it has one, else {}: turns no guardrail decided carry no field.
export function guardrailFieldOf(message) {
  const guardrail = message?.guardrail ?? message?.result?.guardrail;
  return guardrail && typeof guardrail === 'object' ? { guardrail } : {};
}

// A passage's time anchor for the answer prompt and the cited sources:
// date 'YYYY-MM-DD' and dateKind 'uploaded' (the day this version was added to
// the company library), or both null (the sample guide, or no date known).
export function passageDating(passage) {
  const date =
    typeof passage?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(passage.date)
      ? passage.date
      : null;
  return { date, dateKind: date && passage.dateKind === 'uploaded' ? 'uploaded' : null };
}

// The recency rules of the answer SystemMessage. today is 'YYYY-MM-DD' (UTC).
export const recencyInstruction = (today) =>
  `Recency: today is ${today}. Each passage has a date and a dateKind: "uploaded" means the date is the day the document was added to the company library, and null means no date is known. (1) Before answering, note the time anchors in the passages you use: the date, and any effective date, last-updated date, version number, "valid until" date or replacement note written in the text. A date or version written in the text outranks an uploaded date. (2) When passages disagree on the same point, the most recent one wins: answer that point only from it and cite only it. Never combine figures, steps or conditions from an older and a newer passage. (3) After resolving such a disagreement, begin with "According to the latest update, from <date>," using the date of the passage you followed: the date written in its text if it states one, otherwise its date. (4) A passage is outdated only when its text says it has been replaced or withdrawn or was valid until a date before today, or when a newer passage covers the same point differently. Age alone never makes a passage outdated. (5) If every passage that addresses the question is outdated, do not answer from them: set stale=true, return no citations and coverage=none, and say in one sentence that the documents on this are out of date. Otherwise set stale=false. (6) When the passage you rely on states its own last-updated or effective date in its text, mention it once in plain words, for example "effective 1 March 2026". Write dates as day, month name and year. Never invent a date, and never treat a date the user mentions as a document date.`;

// One log line per stale verdict (stdout JSON, Cloud Run jsonPayload). It never
// holds question or answer text, titles or ids.
//   {"severity":"WARNING","event":"onboardai_answer_freshness","environment":"…","verdict":"stale","surface":"chat"}
export function freshnessLine({ environment = 'local', verdict, surface = 'chat' }) {
  if (!freshnessVerdicts.includes(verdict)) throw new TypeError('Unknown freshness verdict.');
  if (surface !== 'chat') throw new TypeError('Unknown freshness surface.');
  return {
    severity: 'WARNING',
    event: 'onboardai_answer_freshness',
    environment,
    verdict,
    surface,
  };
}
export const writeFreshnessLine = (entry) => console.log(JSON.stringify(entry));
