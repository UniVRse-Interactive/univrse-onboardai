// Cards reuse the delivered answer verbatim. They do not add another generated
// policy summary, model call or independent source of company instructions.
export function createAnswerGuide(
  answer,
  { format = 'standard', hasSources = false, kind = 'company' } = {},
) {
  if (!hasSources || kind !== 'company' || typeof answer !== 'string') return null;
  const text = answer.trim();
  if (!text || text.length > 1800) return null;
  const numbered = text
    .split(/(?:^|\s+)\d+[.)]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const isSteps = /^\s*1[.)]\s/.test(text) && numbered.length > 1;
  // Split at sentence boundaries without splitting times, percentages or
  // numbered instructions. Every item preserves the original wording.
  const sentences = isSteps ? numbered : text.split(/(?<=[.!?])\s+(?=[A-Z“"\d])/).filter(Boolean);
  const items = sentences.length <= 4 ? sentences : [text];
  return {
    kind: isSteps ? 'steps' : format === 'example' ? 'example' : 'facts',
    title: isSteps ? 'One step at a time' : format === 'example' ? 'See an example' : 'At a glance',
    items,
  };
}
