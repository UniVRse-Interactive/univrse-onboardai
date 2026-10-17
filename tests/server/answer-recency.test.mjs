// Recency rules and the stale verdict (issue #79): the answer prompt names
// today and each passage's date; a company answer the model marks stale=true
// is replaced by the fixed stale reply with guardrail { verdict: 'stale',
// askHr: true }, coverage none and no sources, before any other fallback; the
// saved message keeps it and a knowledge gap is recorded with the nearest
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
  passageDating,
  recencyInstruction,
  staleReply,
  staleVerdictOf,
} from '../../server/answer-freshness.mjs';
import { createChatStore } from '../../server/chat-store.mjs';
import { startAccountsApp } from './account-harness.mjs';

// The contract text (C-STALE and the recency paragraph), verbatim.
const contractReply =
  "The company documents I have on this are out of date, so I won't rely on them. Please check with HR for the latest guidance.";
const contractParagraph =
  'Recency: today is 2026-10-17. Each passage has a date and a dateKind: "uploaded" means the date is the day the document was added to the company library, and null means no date is known. (1) Before answering, note the time anchors in the passages you use: the date, and any effective date, last-updated date, version number, "valid until" date or replacement note written in the text. A date or version written in the text outranks an uploaded date. (2) When passages disagree on the same point, the most recent one wins: answer that point only from it and cite only it. Never combine figures, steps or conditions from an older and a newer passage. (3) After resolving such a disagreement, begin with "According to the latest update, from <date>," using the date of the passage you followed: the date written in its text if it states one, otherwise its date. (4) A passage is outdated only when its text says it has been replaced or withdrawn or was valid until a date before today, or when a newer passage covers the same point differently. Age alone never makes a passage outdated. (5) If every passage that addresses the question is outdated, do not answer from them: set stale=true, return no citations and coverage=none, and say in one sentence that the documents on this are out of date. Otherwise set stale=false. (6) When the passage you rely on states its own last-updated or effective date in its text, mention it once in plain words, for example "effective 1 March 2026". Write dates as day, month name and year. Never invent a date, and never treat a date the user mentions as a document date.';

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

test('the answer schema requires a boolean stale, and the module exports the contract text', () => {
  assert.deepEqual(answerSchema.properties.stale, { type: 'boolean' });
  assert.deepEqual(answerSchema.required, ['answer', 'citations', 'coverage', 'stale']);
  assert.equal(staleReply, contractReply);
  assert.deepEqual(freshnessVerdicts, ['stale']);
  assert.equal(recencyInstruction('2026-10-17'), contractParagraph);
  assert.equal(staleVerdictOf('company', { stale: true }), 'stale');
  for (const [kind, output] of [
    ['company', { stale: false }],
    ['company', {}],
    ['company', { stale: 'true' }],
    ['conversation', { stale: true }],
    ['clarify', { stale: true }],
    ['checklist', { stale: true }],
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

test('the prompt names today and each passage’s date, right after the inference rule', async () => {
  const { conversations, prompts } = service({
    reply: () => ({ answer: '16 days.', citations: [2], coverage: 'full', stale: false }),
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
    assert.ok(
      system.includes(
        `do not turn an inference into a policy.\n${contractParagraph}\nFor personal recall, use only this user's conversation`,
      ),
    );
    // The rest of the prompt is unchanged around it.
    assert.match(system, /^You are Alya, the polite company and onboarding assistant/);
    assert.ok(system.includes('\nStandalone question: annual leave days\nReference passages: '));
    const sent = JSON.parse(system.slice(system.indexOf('Reference passages: ') + 20));
    assert.deepEqual(sent, [
      { id: 1, ...passages[0] },
      { id: 2, ...passages[1] },
    ]);
  } finally {
    await conversations.close();
  }
});

test('stale=false gives the normal answer, cited passages keep their dates, and no guardrail field', async () => {
  const logs = [];
  const { conversations } = service({
    reply: () => ({
      answer: 'According to the latest update, from 12 January 2026, you get 16 days.',
      citations: [2],
      coverage: 'full',
      stale: false,
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

test('stale=true gives the fixed reply, guardrail, coverage none and no sources, logged once', async () => {
  const logs = [];
  const { conversations, prompts } = service({
    reply: () => ({
      answer: 'The leave policy on this was withdrawn, see Leave Policy 2025.',
      citations: [1, 2],
      coverage: 'full',
      stale: true,
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
      coverage: 'none',
      stale: true,
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
  // Without stale, the same output is still the withheld reply.
  const { conversations: plain } = service({
    reply: () => ({ answer: 'Not sure.', citations: [], coverage: 'none', stale: false }),
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

test('the answer shape and citations are checked before the verdict; other turns ignore stale', async () => {
  const { conversations } = service({
    reply: (messages) =>
      messages.at(-1).content.includes('hello')
        ? { answer: 'Hello!', citations: [], coverage: 'none', stale: true }
        : { answer: 'Out of date.', citations: [7], coverage: 'none', stale: true },
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
            ? { answer: 'Withdrawn.', citations: [], coverage: 'none', stale: true }
            : { answer: 'Nine to five.', citations: [1], coverage: 'full', stale: false },
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
