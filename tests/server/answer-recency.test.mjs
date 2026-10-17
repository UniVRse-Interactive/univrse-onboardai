// Date rules and the stale verdict (issue #79): the answer prompt names
// today and each passage's date after the reference passages; a company
// answer the model returns with coverage "outdated" is replaced by the fixed
// stale reply with guardrail { verdict: 'stale', askHr: true }, coverage none
// and no sources, before any other fallback; the saved message keeps it and a knowledge gap is recorded with the nearest
// source. Fake Gemini models, the in-memory chat stores and synthetic passages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AIMessage } from '@langchain/core/messages';
import {
  answerSchema,
  createConversationService,
  fictionalExampleOpening,
  todayOf,
} from '../../server/gemini-chat-workflow.mjs';
import {
  freshnessLine,
  freshnessVerdicts,
  guardrailFieldOf,
  outdatedCoverage,
  passageDating,
  recencyInstruction,
  staleReply,
  staleVerdictOf,
} from '../../server/answer-freshness.mjs';
import { createChatStore } from '../../server/chat-store.mjs';
import { startAccountsApp } from './account-harness.mjs';

// The contract text (C-STALE and the Dates instruction), verbatim.
const contractReply =
  "The company documents I have on this are out of date, so I won't rely on them. Please check with HR for the latest guidance.";
const contractParagraph =
  'Dates: today is 2026-10-17. Each passage has a date, the day it was added to the company library (dateKind "uploaded"), or null when none is known. Dates only decide which passage to follow when passages conflict: if passages give different answers on the same point, answer that point only from the newest one (a date or version written in its text outranks its uploaded date), cite only it, never mix in an older passage\'s figures, and begin with "According to the latest update, from <day month year>,". A passage is outdated only when its own text says it was withdrawn or replaced, or was valid only until a date before today. Age, a missing date, and sample, draft, unapproved or "confirm with HR" status never make a passage outdated. These rules never reduce what you may answer from a passage that is not outdated: cite it and set coverage by the rules above. Only if every passage on the question is outdated, do not answer from it: give no citations and set coverage=outdated; the user then gets a fixed note that the documents are out of date.';

const passages = [
  {
    title: 'Leave Policy 2025.docx',
    heading: 'Annual leave',
    text: 'Staff get 14 days of annual leave.',
    date: '2025-01-10',
    dateKind: 'uploaded',
  },
  {
    title: 'Leave Policy 2026.docx',
    heading: 'Annual leave',
    text: 'Staff get 16 days of annual leave.',
    date: '2026-01-12',
    dateKind: 'uploaded',
  },
];
const plan = (kind = 'company') => ({
  invoke: async (messages) => ({
    kind,
    query: 'annual leave days',
    clarification: '',
    category: 'onboarding',
    topic: 'annual leave',
    ...(messages.at(-1).content.includes('hello') ? { kind: 'conversation', query: 'hello' } : {}),
  }),
});
// The answer model replies with `reply()` and keeps every SystemMessage.
function models(reply, prompts = []) {
  return {
    prompts,
    plan: plan(),
    answer: {
      invoke: async (messages) => {
        prompts.push(messages[0].content);
        return reply(messages);
      },
    },
    summarize: { invoke: async () => new AIMessage('Earlier.') },
  };
}
function service({ reply, retrieve = async () => passages.map((p) => ({ ...p })), now, logs }) {
  const fake = models(reply);
  const conversations = createConversationService({
    env: { ONBOARDAI_ENVIRONMENT: 'production' },
    models: fake,
    memory: createChatStore({ CHAT_DATABASE_PATH: ':memory:' }),
    retrieve,
    now: now ?? (() => new Date('2026-10-17T03:00:00.000Z')),
    logEvent: (entry) => logs?.push(entry),
  });
  return { conversations, prompts: fake.prompts };
}

test('the answer schema has no stale field, coverage gains outdated, and the module exports the contract text', () => {
  assert.equal('stale' in answerSchema.properties, false);
  assert.deepEqual(answerSchema.properties.coverage.enum, ['full', 'partial', 'none', 'outdated']);
  assert.deepEqual(answerSchema.required, ['answer', 'citations', 'coverage']);
  assert.equal(outdatedCoverage, 'outdated');
  assert.equal(staleReply, contractReply);
  assert.deepEqual(freshnessVerdicts, ['stale']);
  assert.equal(recencyInstruction('2026-10-17'), contractParagraph);
  assert.equal(staleVerdictOf('company', { coverage: 'outdated' }), 'stale');
  assert.equal(staleVerdictOf('company', { coverage: 'outdated', citations: [1, 2] }), 'stale');
  for (const [kind, output] of [
    ['company', { coverage: 'full' }],
    ['company', { coverage: 'none' }],
    ['company', {}],
    ['company', { stale: true, coverage: 'full' }],
    ['company', { stale: true }],
    ['conversation', { coverage: 'outdated' }],
    ['clarify', { coverage: 'outdated' }],
    ['checklist', { coverage: 'outdated' }],
  ])
    assert.equal(staleVerdictOf(kind, output), null);
  assert.deepEqual(passageDating({ date: '2026-01-12', dateKind: 'uploaded' }), {
    date: '2026-01-12',
    dateKind: 'uploaded',
  });
  for (const value of [{}, { date: '12/01/2026', dateKind: 'uploaded' }, { date: null }])
    assert.deepEqual(passageDating(value), { date: null, dateKind: null });
  assert.deepEqual(passageDating({ date: '2026-01-12', dateKind: 'effective' }), {
    date: '2026-01-12',
    dateKind: null,
  });
  assert.equal(
    todayOf(() => new Date('2026-10-17T23:59:59.000-05:00')),
    '2026-10-18',
  );
  assert.equal(
    todayOf(() => Date.parse('2026-10-17T00:00:00.000Z')),
    '2026-10-17',
  );
  assert.deepEqual(guardrailFieldOf({ result: { guardrail: { verdict: 'stale', askHr: true } } }), {
    guardrail: { verdict: 'stale', askHr: true },
  });
  assert.deepEqual(guardrailFieldOf({ result: {} }), {});
  assert.deepEqual(guardrailFieldOf(null), {});
});

test('the Dates instruction comes after the reference passages, and is absent without passages', async () => {
  const { conversations, prompts } = service({
    reply: () => ({ answer: '16 days.', citations: [2], coverage: 'full' }),
  });
  try {
    const chat = await conversations.memory.create('person');
    await conversations.ask(
      'person',
      chat.id,
      'How many days of annual leave do I get?',
      randomUUID(),
    );
    const [system] = prompts;
    assert.ok(system.endsWith(`\n${contractParagraph}`));
    assert.equal(system.includes('Recency:'), false);
    // Nothing is added mid-prompt: the inference rule is followed directly by the recall rules.
    assert.ok(
      system.includes(
        "do not turn an inference into a policy. For personal recall, use only this user's conversation",
      ),
    );
    assert.match(system, /^You are Alya, the polite company and onboarding assistant/);
    assert.ok(system.includes('\nStandalone question: annual leave days\nReference passages: '));
    const start = system.indexOf('Reference passages: ') + 20;
    const sent = JSON.parse(system.slice(start, system.length - contractParagraph.length - 1));
    assert.deepEqual(sent, [
      { id: 1, ...passages[0] },
      { id: 2, ...passages[1] },
    ]);
    assert.ok(system.indexOf('Dates: today') > system.indexOf('Reference passages: '));
  } finally {
    await conversations.close();
  }
  // With no passages there is no answer call at all, so no Dates text either.
  const { conversations: empty, prompts: none } = service({
    reply: () => assert.fail('no answer call'),
    retrieve: async () => [],
  });
  try {
    const chat = await empty.memory.create('person');
    await empty.ask('person', chat.id, 'Leave days?', randomUUID());
    assert.deepEqual(none, []);
  } finally {
    await empty.close();
  }
  // A conversation turn carries no passages, so no Dates instruction.
  const { conversations: talk, prompts: talked } = service({
    reply: () => ({ answer: 'Hello!', citations: [], coverage: 'none' }),
  });
  try {
    const chat = await talk.memory.create('person');
    await talk.ask('person', chat.id, 'hello Alya', randomUUID());
    assert.equal(talked.length, 1);
    assert.equal(talked[0].includes('Dates: today'), false);
  } finally {
    await talk.close();
  }
});

test('a normal coverage gives the normal answer, cited passages keep their dates, and no guardrail field', async () => {
  const logs = [];
  const { conversations } = service({
    reply: () => ({
      answer: 'According to the latest update, from 12 January 2026, you get 16 days.',
      citations: [2],
      coverage: 'full',
    }),
    logs,
  });
  try {
    const chat = await conversations.memory.create('person');
    const result = await conversations.ask('person', chat.id, 'Leave days?', randomUUID());
    assert.match(result.answer, /16 days/);
    assert.equal(result.coverage, 'full');
    assert.equal(result.source, 'Leave Policy 2026.docx');
    assert.deepEqual(result.passages, [{ id: 2, ...passages[1] }]);
    assert.equal('guardrail' in result, false);
    const saved = (await conversations.memory.read('person', chat.id)).messages.at(-1);
    assert.deepEqual(saved.result.passages, [{ id: 2, ...passages[1] }]);
    assert.equal('guardrail' in saved, false);
    assert.deepEqual(logs, []);
  } finally {
    await conversations.close();
  }
});

test('coverage outdated gives the fixed reply, guardrail, coverage none and no sources, logged once', async () => {
  const logs = [];
  const { conversations, prompts } = service({
    reply: () => ({
      answer: 'The leave policy on this was withdrawn, see Leave Policy 2025.',
      citations: [1, 2],
      coverage: 'outdated',
    }),
    logs,
  });
  try {
    const chat = await conversations.memory.create('person');
    const requestId = randomUUID();
    const result = await conversations.ask('person', chat.id, 'Leave days?', requestId);
    assert.equal(result.answer, contractReply);
    assert.deepEqual(result.guardrail, { verdict: 'stale', askHr: true });
    assert.equal(result.coverage, 'none');
    assert.equal(result.category, 'onboarding');
    assert.deepEqual(result.passages, []);
    assert.equal(result.source, 'No confirmed company source');
    assert.equal(result.card, null);
    assert.ok(!JSON.stringify(result).includes('withdrawn'));
    assert.deepEqual(logs, [
      {
        severity: 'WARNING',
        event: 'onboardai_answer_freshness',
        environment: 'production',
        verdict: 'stale',
        surface: 'chat',
      },
    ]);
    // The saved message holds the same reply and the guardrail at the top level.
    const saved = (await conversations.memory.read('person', chat.id)).messages.at(-1);
    assert.equal(saved.text, contractReply);
    assert.deepEqual(saved.guardrail, { verdict: 'stale', askHr: true });
    assert.deepEqual(saved.result.guardrail, { verdict: 'stale', askHr: true });
    assert.deepEqual(saved.result.passages, []);
    // Repeating the request returns the saved answer with no model call or log.
    const again = await conversations.ask('person', chat.id, 'Leave days?', requestId);
    assert.equal(again.answer, contractReply);
    assert.deepEqual(again.guardrail, { verdict: 'stale', askHr: true });
    assert.equal(prompts.length, 1);
    assert.equal(logs.length, 1);
  } finally {
    await conversations.close();
  }
});

test('the stale verdict runs before the zero-citation fallback and the example opening', async () => {
  const { conversations } = service({
    reply: () => ({
      answer: 'These documents are out of date.',
      citations: [],
      coverage: 'outdated',
    }),
  });
  try {
    const chat = await conversations.memory.create('person');
    await conversations.settings('person', chat.id, { preference: 'example' });
    const result = await conversations.ask('person', chat.id, 'Leave days?', randomUUID());
    // Not "The connected guidance does not clearly establish that answer…",
    // and no fictional-example opening.
    assert.equal(result.answer, contractReply);
    assert.ok(!result.answer.includes(fictionalExampleOpening));
    assert.deepEqual(result.guardrail, { verdict: 'stale', askHr: true });
  } finally {
    await conversations.close();
  }
  // Without outdated, the same output is still the withheld reply.
  const { conversations: plain } = service({
    reply: () => ({ answer: 'Not sure.', citations: [], coverage: 'none' }),
  });
  try {
    const chat = await plain.memory.create('person');
    const result = await plain.ask('person', chat.id, 'Leave days?', randomUUID());
    assert.match(result.answer, /does not clearly establish/);
    assert.equal('guardrail' in result, false);
  } finally {
    await plain.close();
  }
});

test('the answer shape and citations are checked before the verdict; other turns ignore outdated', async () => {
  const { conversations } = service({
    reply: (messages) =>
      messages.at(-1).content.includes('hello')
        ? { answer: 'Hello!', citations: [], coverage: 'outdated' }
        : { answer: 'Out of date.', citations: [7], coverage: 'outdated' },
  });
  try {
    const chat = await conversations.memory.create('person');
    await assert.rejects(
      conversations.ask('person', chat.id, 'Leave days?', randomUUID()),
      /Invalid citations/,
    );
    // A conversation turn is never a stale company reply.
    const greeting = await conversations.ask('person', chat.id, 'hello Alya', randomUUID());
    assert.equal(greeting.answer, 'Hello!');
    assert.equal('guardrail' in greeting, false);
  } finally {
    await conversations.close();
  }
  // Nothing retrieved: the zero-passage reply, with no answer call and no guardrail.
  const { conversations: empty, prompts } = service({
    reply: () => assert.fail('no answer call'),
    retrieve: async () => [],
  });
  try {
    const chat = await empty.memory.create('person');
    const result = await empty.ask('person', chat.id, 'Leave days?', randomUUID());
    assert.match(result.answer, /couldn’t find that information/);
    assert.equal(result.coverage, 'none');
    assert.equal('guardrail' in result, false);
    assert.equal(prompts.length, 0);
  } finally {
    await empty.close();
  }
});

test('outdated never reaches a reply or a saved message, and a stale flag from the model is ignored', async () => {
  const { conversations } = service({
    reply: () => ({
      answer: 'Out of date.',
      citations: [1],
      coverage: 'outdated',
    }),
  });
  try {
    const chat = await conversations.memory.create('person');
    const result = await conversations.ask('person', chat.id, 'Leave days?', randomUUID());
    assert.equal(result.coverage, 'none');
    assert.equal(result.answer, contractReply);
    assert.deepEqual(result.passages, []);
    const saved = (await conversations.memory.read('person', chat.id)).messages;
    assert.ok(!JSON.stringify(saved).includes('outdated'));
    assert.deepEqual(saved.at(-1).result.passages, []);
    assert.equal(saved.at(-1).guardrail.verdict, 'stale');
  } finally {
    await conversations.close();
  }
  // A model that still sends stale: true with a normal coverage is not stale.
  const { conversations: legacy } = service({
    reply: () => ({ answer: '16 days.', citations: [2], coverage: 'full', stale: true }),
  });
  try {
    const chat = await legacy.memory.create('person');
    const result = await legacy.ask('person', chat.id, 'Leave days?', randomUUID());
    assert.equal(result.answer, '16 days.');
    assert.equal(result.coverage, 'full');
    assert.equal('guardrail' in result, false);
  } finally {
    await legacy.close();
  }
});

test('freshnessLine has fixed keys and rejects unknown values', () => {
  assert.deepEqual(Object.keys(freshnessLine({ verdict: 'stale' })), [
    'severity',
    'event',
    'environment',
    'verdict',
    'surface',
  ]);
  assert.throws(() => freshnessLine({ verdict: 'pass' }), TypeError);
  assert.throws(() => freshnessLine({ verdict: 'stale', surface: 'briefing_check' }), TypeError);
});

test('over HTTP: the stale reply, the saved message’s guardrail and the knowledge gap with its nearest source', async (t) => {
  const freshness = [];
  t.mock.method(console, 'log', (text) => {
    if (typeof text === 'string' && text.includes('onboardai_answer_freshness'))
      freshness.push(JSON.parse(text));
  });
  const stale = {
    title: 'Badge Policy.docx',
    heading: 'Collection',
    text: 'This policy was withdrawn on 1 June 2026.',
  };
  const app = await startAccountsApp({
    mode: 'gemini-chat',
    companyRetrieve: async (query) =>
      query.includes('badge') ? [{ ...stale }] : [{ title: 'Guide.pdf', heading: '', text: 'Hi.' }],
    models: () => ({
      plan: {
        invoke: async (messages) => {
          const q = messages.at(-1).content.toLowerCase();
          return {
            kind: 'company',
            query: q.includes('badge') ? 'badge collection' : 'office hours',
            clarification: '',
            category: 'onboarding',
            topic: q.includes('badge') ? 'badges' : 'hours',
          };
        },
      },
      answer: {
        invoke: async (messages) =>
          messages[0].content.includes('withdrawn on 1 June 2026')
            ? { answer: 'Withdrawn.', citations: [], coverage: 'outdated' }
            : { answer: 'Nine to five.', citations: [1], coverage: 'full' },
      },
      summarize: { invoke: async () => new AIMessage('Earlier.') },
    }),
  });
  try {
    const hr = await app.hrBrowser();
    const { browser } = await app.readyEmployee(hr);
    const chat = (await browser.post('/api/conversations')).body;
    const post = (question) =>
      browser.post('/api/chat', {
        question,
        taskId: 'quiz-part-1',
        conversationId: chat.id,
        requestId: randomUUID(),
      });
    const normal = await post('What are the office hours?');
    assert.equal(normal.status, 200, normal.text);
    assert.equal('guardrail' in normal.body, false);
    const answered = await post('Where do I collect my badge?');
    assert.equal(answered.status, 200, answered.text);
    const contract = {
      answer: contractReply,
      coverage: 'none',
      category: 'onboarding',
      passages: [],
      source: 'No confirmed company source',
      guardrail: { verdict: 'stale', askHr: true },
    };
    for (const [key, value] of Object.entries(contract))
      assert.deepEqual(answered.body[key], value, key);
    assert.equal(answered.body.journey, undefined);

    const saved = (await browser.get(`/api/conversations/${chat.id}`)).body.messages;
    const [first, last] = [saved[1], saved.at(-1)];
    assert.equal('guardrail' in first, false);
    assert.equal(last.text, contractReply);
    assert.equal(last.coverage, 'none');
    assert.equal(last.category, 'onboarding');
    assert.deepEqual(last.guardrail, { verdict: 'stale', askHr: true });
    assert.deepEqual(last.result.passages, []);
    assert.equal(last.result.source, 'No confirmed company source');

    // The gap names the stale document as the nearest source.
    const gaps = app.firestore.paths('knowledgeGaps/').map((p) => app.firestore.read(p));
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].topic, 'badges');
    assert.deepEqual(gaps[0].nearestSource, { title: 'Badge Policy.docx', heading: 'Collection' });
    assert.deepEqual(freshness, [
      {
        severity: 'WARNING',
        event: 'onboardai_answer_freshness',
        environment: 'local',
        verdict: 'stale',
        surface: 'chat',
      },
    ]);
  } finally {
    await app.close();
  }
});
