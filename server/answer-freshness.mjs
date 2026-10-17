// Stale company documents (issue #79). The answer prompt's date rules let
// Gemini arbitrate between passages by their dates; when every passage on the
// question is out of date, the model returns coverage "outdated" in its
// structured output (the answer schema's coverage enum has that one extra
// value; there is no separate stale field). The server then discards the
// model's text and sends this fixed reply with the Ask HR offer (coverage
// none), as the no-source path does. Alya's wording is never parsed.
//
// The verdict is checked right after the answer is validated and before any
// other fallback (the zero-citation reply, coverage, the example opening), and
// it would come before #64's no_source and evaluator steps too: a stale answer
// has no sources, so those steps would otherwise swallow it.
//
// Why a coverage value and why the paragraph sits after the passages (#79 B2
// round 2, measured with real gemini-3.5-flash-lite): on weakly relevant
// passages the model's cite-or-withhold choice moved with any sentence added
// to the middle of the prompt, and a separate required boolean made it more
// conservative too. At the end of the SystemMessage, worded as a tie-breaker
// that never narrows an answer, the paragraph kept the withheld rate at the
// pre-#79 level. A single enum value also leaves no "stale but fully
// covered" contradiction for the server to resolve.

export const staleReply =
  "The company documents I have on this are out of date, so I won't rely on them. Please check with HR for the latest guidance.";

export const freshnessVerdicts = Object.freeze(['stale']);

// The answer schema's extra coverage value: every passage on the question is
// out of date. It never reaches a reply or a saved message (those say "none").
export const outdatedCoverage = 'outdated';

// 'stale' for a company answer whose coverage is "outdated", else null. The
// model's citations are ignored on this path (it sometimes cites the withdrawn
// passage it relied on to decide).
export function staleVerdictOf(planKind, output) {
  return planKind === 'company' && output?.coverage === outdatedCoverage ? 'stale' : null;
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

// The date rules of the answer SystemMessage, appended after the reference
// passages of a company turn. today is 'YYYY-MM-DD' (UTC).
export const recencyInstruction = (today) =>
  `Dates: today is ${today}. Each passage has a date, the day it was added to the company library (dateKind "uploaded"), or null when none is known. Dates only decide which passage to follow when passages conflict: if passages give different answers on the same point, answer that point only from the newest one (a date or version written in its text outranks its uploaded date), cite only it, never mix in an older passage's figures, and begin with "According to the latest update, from <day month year>,". A passage is outdated only when its own text says it was withdrawn or replaced, or was valid only until a date before today. Age, a missing date, and sample, draft, unapproved or "confirm with HR" status never make a passage outdated. These rules never reduce what you may answer from a passage that is not outdated: cite it and set coverage by the rules above. Only if every passage on the question is outdated, do not answer from it: give no citations and set coverage=${outdatedCoverage}; the user then gets a fixed note that the documents are out of date.`;

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
