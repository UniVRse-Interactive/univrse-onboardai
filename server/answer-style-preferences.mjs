// Teaching formats and handbook subjects, not medical or ability profiles.
// Actual policy content is always retrieved from the existing Drive documents.
const subjectHints = [
  { id: 'welcome', terms: ['vision', 'mission', 'values', 'welcome'] },
  { id: 'first-day', terms: ['hours', 'dress', 'wear', 'tshirt', 'shirt', 'attire', 'workspace'] },
  { id: 'daily-routine', terms: ['checkin', 'checkout', 'attendance', 'punctuality', 'report'] },
  { id: 'meetings', terms: ['meeting', 'meetings', 'zoom'] },
  { id: 'information', terms: ['confidentiality', 'internet', 'email', 'password', 'information'] },
  { id: 'respect', terms: ['respect', 'harassment', 'discrimination'] },
  { id: 'leave', terms: ['leave', 'absence', 'holiday', 'handover', 'sick'] },
  { id: 'expenses', terms: ['travel', 'expenses', 'claim', 'claims', 'reimbursement'] },
];
export const teachingFormats = ['auto', 'standard', 'steps', 'example', 'brief'];
const reasons = new Set([
  'default',
  'employee-choice',
  'explanation-request',
  'example-request',
  'brief-request',
  'revisited-topic',
  'understood',
]);

export function normaliseLearning(value = {}) {
  const validTopic = (id) => subjectHints.some((t) => t.id === id);
  return {
    preference: teachingFormats.includes(value.preference) ? value.preference : 'auto',
    format: teachingFormats.slice(1).includes(value.format) ? value.format : 'standard',
    reason: reasons.has(value.reason) ? value.reason : 'default',
    lastTopic: validTopic(value.lastTopic) ? value.lastTopic : null,
    repeats: Number.isInteger(value.repeats) ? Math.max(0, Math.min(3, value.repeats)) : 0,
  };
}

function topicFor(query) {
  const words = new Set(
    query
      .toLowerCase()
      .replace(/t[\s-]?shirts?/g, 'tshirt')
      .replace(/check[\s-]?in/g, 'checkin')
      .replace(/check[\s-]?out/g, 'checkout')
      .match(/[a-z]+/g) || [],
  );
  const ranked = subjectHints
    .map((t) => ({ id: t.id, count: t.terms.filter((w) => words.has(w)).length }))
    .sort((a, b) => b.count - a.count);
  return ranked[0]?.count ? ranked[0].id : null;
}

export function supportRequest(question) {
  const text = question.toLowerCase().replace(/[’]/g, "'").trim();
  // Only direct requests / statements of understanding. Spelling, grammar,
  // time taken, identity and a claimed diagnosis do not select a learning path.
  if (
    /\b(?:i (?:do understand|understand now|am not confused)|i don't need help)\b|\b(?:saya dah faham|saya sudah faham)\b/.test(
      text,
    )
  )
    return { format: 'standard', reason: 'understood' };
  if (
    /\b(?:make (?:it|the answer) (?:brief|shorter)|summari[sz]e|keep (?:it|the answer|your answer) (?:short|brief)|answer briefly|short answer|jawapan ringkas|ringkaskan)\b/.test(
      text,
    ) &&
    !/\b(?:don't|do not|not) (?:(?:make|keep) (?:it|the answer|your answer) )?(?:brief|shorter|short|ringkas)\b/.test(
      text,
    )
  )
    return { format: 'brief', reason: 'brief-request' };
  if (
    /\b(?:give|show|use|need|want|another) (?:me |a |an |another |worked |simple )*(?:example|contoh)\b|\b(?:beri|bagi) contoh\b/.test(
      text,
    )
  )
    return { format: 'example', reason: 'example-request' };
  if (
    /\b(?:i (?:don't|dont|do not|didn't|didnt|cannot|can't) (?:understand|get it)|i(?:'m| am) confused|this is (?:too much|confusing)|break (?:it|this|that|the task) down|explain (?:it |that |this )?(?:again|more simply|in simple words)|step[ -]by[ -]step|(?:need|want|use|give me|explain (?:it|this|that) in) (?:smaller|small|simpler) steps|one (?:step|task) at a time|saya (?:tak|tidak) faham|langkah demi langkah)\b/.test(
      text,
    ) &&
    !/\b(?:don't|dont|do not|never) (?:need|want|use|give me) (?:smaller|small|simpler) steps\b/.test(
      text,
    )
  )
    return { format: 'steps', reason: 'explanation-request' };
  return null;
}

export function adaptLearning(value, { question = '', query = '' } = {}) {
  const learning = normaliseLearning(value),
    topic = topicFor(query),
    request = supportRequest(question);
  if (topic) {
    learning.repeats = topic === learning.lastTopic ? Math.min(3, learning.repeats + 1) : 1;
    learning.lastTopic = topic;
  }
  if (learning.preference !== 'auto') {
    learning.format = learning.preference;
    learning.reason = 'employee-choice';
  } else if (request) {
    learning.format = request.format;
    learning.reason = request.reason;
  } else if (topic && learning.repeats >= 3) {
    learning.format = 'steps';
    learning.reason = 'revisited-topic';
  } else if (topic && learning.repeats === 1) {
    learning.format = 'standard';
    learning.reason = 'default';
  }
  return learning;
}

export function learningInstruction(value) {
  const learning = normaliseLearning(value);
  const format = {
    standard:
      'Use three clear, complete sentences, usually about 40-65 words. Answer the exact question first, explain one useful detail, then give a relevant condition or next action from the guidance. For permission questions, state the supported permission or restriction directly before background information. Resolve brief follow-ups using the current subject, but follow a new topic immediately. Prefer information the employee can use over general background. Explain unfamiliar terms when the guidance supports that explanation. Use familiar words and one clear idea per sentence. Preserve necessary policy conditions and exceptions; accuracy takes priority over length. Use fewer sentences when the source supports only a short answer. Do not pad the answer with generic filler.',
    steps:
      'Use simple words and at most 3 short numbered steps. Explain unfamiliar terms. Focus on one manageable action; keep necessary policy conditions.',
    example:
      'Give a short explanation and one concrete fictional worked example. Explicitly call the example fictional; do not invent people, company rules or form links.',
    brief:
      'Use two very short, complete sentences with familiar words: the direct answer and one useful detail. Preserve important conditions and exceptions; accuracy takes priority over length. Do not add generic filler.',
  }[learning.format];
  return `Answer presentation: ${format}\nAnswer the employee's current question about any company information or onboarding task. Follow a new subject immediately; do not continue an old lesson, impose a topic menu, quiz, stage or completion workflow. Apply current settings ahead of older presentation requests in the chat. Fictional examples must not invent company requirements, tools, channels, links or deadlines. If a process is unspecified, say so and suggest confirming with HR/supervisor. Never infer, score or label autism, neurodivergence, disability, intelligence, learning speed or abnormal behaviour from chat. Do not use diagnoses, grammar, spelling, response time or voice to choose content or workplace outcomes. Provide the same company guidance and access to all company and onboarding questions; change only the explanation and examples. Do not describe anyone as a normal/abnormal learner. Health-related disclosure does not establish a diagnosis or change their entitlement. Never include a health/ability assessment in a conversation summary. No sanctions or employment decisions arise from this chat.`;
}

export function updateLearning(value, patch) {
  if (
    !patch ||
    typeof patch !== 'object' ||
    Array.isArray(patch) ||
    Object.keys(patch).some((k) => !['preference', 'reset'].includes(k))
  )
    throw new Error('Invalid learning settings');
  if (patch.reset !== undefined && typeof patch.reset !== 'boolean')
    throw new Error('Invalid learning settings');
  if (patch.reset === true) return normaliseLearning();
  const learning = normaliseLearning(value);
  if (patch.preference !== undefined) {
    if (!teachingFormats.includes(patch.preference))
      throw new Error('Choose a supported explanation format');
    learning.preference = patch.preference;
    learning.format = patch.preference === 'auto' ? 'standard' : patch.preference;
    learning.reason = patch.preference === 'auto' ? 'default' : 'employee-choice';
    learning.lastTopic = null;
    learning.repeats = 0;
  }
  return learning;
}
