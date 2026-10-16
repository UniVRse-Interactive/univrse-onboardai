import { adaptLearning, supportRequest } from './answer-style-preferences.mjs';

export function sourceQuestion(question, messages = []) {
  const previousQuery = () =>
    messages.findLast((message) => message.role === 'assistant' && message.result?.searchQuery)
      ?.result.searchQuery ||
    messages.findLast((message) => message.role === 'user' && !supportRequest(message.text))?.text;
  if (!supportRequest(question)) {
    // Narrow, explicit references only. A new named subject never inherits the
    // old question; dates alone cannot establish an employee's eligibility.
    const dayFollowup = question.match(
      /^(?:(?:and |but )?(?:what about|how about|and on|on|what if it(?:'s| is))\s+)(Mondays?|Tuesdays?|Wednesdays?|Thursdays?|Fridays?|Saturdays?|Sundays?|weekends?)[?.!\s]*$/i,
    );
    const sameSubject =
      /^(?:what does (?:that|this) mean|can you explain (?:that|this)|tell me more|more details|why is that)[?.!\s]*$/i.test(
        question,
      );
    const previous = previousQuery();
    if (previous && (dayFollowup || sameSubject))
      return dayFollowup ? `${previous} ${dayFollowup[1]}` : previous;
    return question;
  }
  const explicit = question.match(/\bfor this question:\s*([\s\S]+)$/i)?.[1]?.trim();
  if (explicit) return explicit;
  const subject = question
    .toLowerCase()
    .replace(
      /\b(please|i|me|my|you|can|could|would|give|show|use|need|want|another|a|an|the|worked|example|simple|explain|explanation|again|more|simply|smaller|small|simpler|steps|step|by|one|at|time|short|brief|shorter|answer|keep|it|this|that|same|topic|question|for|on|about|of|understand|now|do|not|don|t|beri|bagi|contoh|saya|tak|tidak|faham|langkah|demi|ringkaskan|jawapan|ringkas)\b/g,
      '',
    )
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
  if (subject) return question;
  return previousQuery() || question;
}

export function sourceAnswerSupport(previous, { question, query, answer, matched }) {
  let learning = adaptLearning(previous, { question, query });
  const hasExample =
    /(?:^|\n|[.!?]\s+)(?:for example[,:]?|worked example:|example:|contoh[,:])/i.test(answer);
  const exampleUnavailable = learning.format === 'example' && (!matched || !hasExample);
  // The request is still recorded, but a missing example is not counted as
  // a delivered worked example. Source search never invents company rules.
  if (!matched || exampleUnavailable) learning = { ...learning, format: 'standard' };
  return { learning, exampleUnavailable };
}
