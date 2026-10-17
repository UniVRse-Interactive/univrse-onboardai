import { readFileSync, statSync } from 'node:fs';
import {
  APPROVED_POLICIES,
  RESPONSIBILITY_ITEMS,
  SUPPORT_ROUTING_SCENARIOS,
  VERIFIED_SUPPORT_DIRECTORY,
} from './task-verification.mjs';

// The configuration point for approved verification content. The built-in
// defaults (task-verification.mjs) only restate the onboarding plan. HR can
// replace or extend them with a JSON file named by VERIFICATION_CONTENT_FILE
// (see docs/verification-content.md). Every part is validated; an invalid part
// is ignored with a warning, so a bad edit never serves a broken quiz.
//
// {
//   "policies": { "policies.data-protection": {
//       "title": "...", "sourceTitle": "...",
//       "document": { "title": "...", "url": "https://..." },      // optional
//       "quiz": { "questions": [ { "id": "q1", "prompt": "...", "multiple": false,
//           "options": [ { "id": "a", "text": "..." } ],
//           "correct": ["a"], "explanation": "..." } ] }             // optional
//   } },
//   "supportContacts": [ { "name": "...", "email": "..." | null, "purpose": "..." } ],
//   "supportRouting": [ { "id": "...", "situation": "...", "options": [ { "id", "label" } ],
//       "correctId": "...", "explanation": "..." } ],
//   "responsibilities": { "default": ["..."], "byDepartment": { "Finance": ["..."] } }
// }

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const str = (value, max = 600) => typeof value === 'string' && value.trim() && value.length <= max;
const httpsUrl = (value) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

export function validQuestion(question) {
  if (
    !isObject(question) ||
    !str(question.id, 40) ||
    !str(question.prompt) ||
    !str(question.explanation)
  )
    return false;
  const options = question.options;
  if (!Array.isArray(options) || options.length < 2) return false;
  if (!options.every((o) => isObject(o) && str(o.id, 40) && str(o.text))) return false;
  const ids = options.map((o) => o.id);
  if (new Set(ids).size !== ids.length) return false;
  const correct = question.correct;
  return (
    Array.isArray(correct) &&
    correct.length >= 1 &&
    correct.every((id) => ids.includes(id)) &&
    new Set(correct).size === correct.length
  );
}

function validPolicy(id, policy) {
  if (!id.startsWith('policies.') || !isObject(policy) || !str(policy.title, 120)) return false;
  if (
    policy.document !== undefined &&
    !(str(policy.document?.title, 160) && httpsUrl(policy.document?.url))
  )
    return false;
  if (policy.quiz === undefined) return true;
  const questions = policy.quiz?.questions;
  return (
    Array.isArray(questions) &&
    questions.length > 0 &&
    questions.every(validQuestion) &&
    new Set(questions.map((q) => q.id)).size === questions.length
  );
}

const normalizeQuestion = (q) =>
  q.type === 'match'
    ? {
        id: q.id,
        type: 'match',
        prompt: q.prompt,
        pairs: q.pairs.map(({ id, text, correct }) => ({ id, text, correct })),
        choices: q.choices.map(({ id, label }) => ({ id, label })),
        explanation: q.explanation,
      }
    : {
        id: q.id,
        type: q.correct.length > 1 ? 'multi' : 'single',
        prompt: q.prompt,
        multiple: q.correct.length > 1,
        options: q.options.map(({ id, text }) => ({ id, text })),
        correct: q.correct,
        explanation: q.explanation,
      };

function validRouting(list) {
  return (
    Array.isArray(list) &&
    list.length > 0 &&
    list.every(
      (s) =>
        isObject(s) &&
        str(s.id, 40) &&
        str(s.situation) &&
        str(s.explanation) &&
        Array.isArray(s.options) &&
        s.options.length >= 2 &&
        s.options.every((o) => isObject(o) && str(o.id, 40) && str(o.label)) &&
        s.options.some((o) => o.id === s.correctId),
    )
  );
}

const validContacts = (list) =>
  Array.isArray(list) &&
  list.every(
    (c) =>
      isObject(c) &&
      str(c.name, 120) &&
      str(c.purpose) &&
      (c.email === null ||
        c.email === undefined ||
        (str(c.email, 254) && /^\S+@\S+\.\S+$/.test(c.email))),
  );

const validResponsibilities = (value) =>
  isObject(value) &&
  Array.isArray(value.default) &&
  value.default.length > 0 &&
  value.default.every((i) => str(i)) &&
  (value.byDepartment === undefined ||
    (isObject(value.byDepartment) &&
      Object.values(value.byDepartment).every(
        (l) => Array.isArray(l) && l.length > 0 && l.every((i) => str(i)),
      )));

// Merges validated overrides over the defaults.
export function buildVerificationContent(config = {}, log = console.warn) {
  const content = {
    policies: { ...APPROVED_POLICIES },
    supportRouting: SUPPORT_ROUTING_SCENARIOS,
    directory: VERIFIED_SUPPORT_DIRECTORY,
    responsibilities: { default: [...RESPONSIBILITY_ITEMS], byDepartment: {} },
  };
  if (isObject(config.policies)) {
    for (const [id, policy] of Object.entries(config.policies)) {
      if (!validPolicy(id, policy)) {
        log(`verification-content: ignored invalid policy "${id}"`);
        continue;
      }
      content.policies[id] = {
        title: policy.title,
        sourceTitle: policy.sourceTitle || policy.title,
        objectives: Array.isArray(policy.objectives) ? policy.objectives.filter((o) => str(o)) : [],
        ...(policy.document ? { document: policy.document } : {}),
        ...(policy.quiz
          ? { quiz: { questions: policy.quiz.questions.map(normalizeQuestion) } }
          : {}),
      };
    }
  }
  if (config.supportContacts !== undefined) {
    if (validContacts(config.supportContacts))
      content.directory = {
        contacts: config.supportContacts.map((c) => ({ ...c, email: c.email ?? null })),
      };
    else log('verification-content: ignored invalid supportContacts');
  }
  if (config.supportRouting !== undefined) {
    if (validRouting(config.supportRouting)) content.supportRouting = config.supportRouting;
    else log('verification-content: ignored invalid supportRouting');
  }
  if (config.responsibilities !== undefined) {
    if (validResponsibilities(config.responsibilities))
      content.responsibilities = {
        default: config.responsibilities.default,
        byDepartment: config.responsibilities.byDepartment || {},
      };
    else log('verification-content: ignored invalid responsibilities');
  }
  return content;
}

// Reads the optional file again whenever it changes.
export function createVerificationContentSource({ env = process.env, log = console.warn } = {}) {
  let cached = { key: null, content: null };
  return function current() {
    const path = env.VERIFICATION_CONTENT_FILE;
    let key = 'defaults';
    if (path) {
      try {
        key = path + ':' + statSync(path).mtimeMs;
      } catch {
        key = path + ':missing';
      }
    }
    if (cached.key === key) return cached.content;
    let config = {};
    if (path && !key.endsWith(':missing')) {
      try {
        config = JSON.parse(readFileSync(path, 'utf8'));
      } catch (e) {
        log('verification-content: could not read ' + path + ': ' + e.message);
      }
    } else if (path) log('verification-content: file not found: ' + path);
    cached = { key, content: buildVerificationContent(config, log) };
    return cached.content;
  };
}
