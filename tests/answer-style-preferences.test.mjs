import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { AIMessage } from '@langchain/core/messages';
import {
  normaliseLearning,
  adaptLearning,
  updateLearning,
  learningInstruction,
} from '../server/answer-style-preferences.mjs';
import { chatStores } from './server/chat-stores.mjs';
import { createConversationService } from '../server/gemini-chat-workflow.mjs';
import { createApp } from '../server/api-routes.mjs';

const source = {
  title: 'Synthetic test handbook',
  heading: 'Work updates',
  text: 'Example training guidance: prepare a short work update using completed tasks and next steps.',
};
function engine({ answer, plan, retrieve = async () => [source], store = chatStores[0] } = {}) {
  return createConversationService({
    env: {},
    memory: store.create(),
    retrieve,
    models: {
      plan: {
        invoke:
          plan ||
          (async () => ({
            kind: 'company',
            query: 'attendance check in work report',
            clarification: '',
          })),
      },
      answer: {
        invoke:
          answer ||
          (async () => ({
            answer: 'Use completed tasks and next steps in your update.',
            citations: [1],
          })),
      },
      summarize: { invoke: async () => new AIMessage('Earlier questions concerned work updates.') },
    },
  });
}

test('support uses direct requests, not diagnoses, spelling, identities or alleged slow learning', () => {
  for (const question of [
    'I have autism.',
    'I am neurodivergent.',
    'They say I have mild autism.',
    'I learn slowly.',
    'whut tym wrk',
    'I am not confused.',
    'What does a brief meeting mean?',
  ]) {
    assert.equal(adaptLearning({}, { question }).format, 'standard', question);
  }
  assert.equal(
    adaptLearning({}, { question: 'I do not understand. Explain again.' }).format,
    'steps',
  );
  assert.equal(adaptLearning({}, { question: 'I dont get it. Break it down.' }).format, 'steps');
  assert.equal(adaptLearning({}, { question: 'Saya tak faham.' }).format, 'steps');
  assert.equal(adaptLearning({}, { question: 'Give me a worked example.' }).format, 'example');
  assert.equal(adaptLearning({}, { question: 'Keep it short please.' }).format, 'brief');
  assert.equal(adaptLearning({}, { question: 'Do not keep it short.' }).format, 'standard');
  const profile = normaliseLearning({
    diagnosis: 'autism',
    abilityScore: 1,
    learningSpeed: 'slow',
  });
  assert.ok(!JSON.stringify(profile).includes('autism'));
  assert.ok(!('abilityScore' in profile));
});

test('revisiting a topic changes presentation, with an explanation and manual override', () => {
  let learning = normaliseLearning();
  for (let i = 0; i < 3; i++)
    learning = adaptLearning(learning, {
      question: 'Tell me about the work routine.',
      query: 'attendance check in',
    });
  assert.equal(learning.format, 'steps');
  assert.equal(learning.reason, 'revisited-topic');
  learning = updateLearning(learning, { preference: 'brief' });
  learning = adaptLearning(learning, { question: 'Explain again.', query: 'attendance check in' });
  assert.equal(learning.format, 'brief');
  assert.equal(learning.reason, 'employee-choice');
  learning = updateLearning(learning, { reset: true });
  assert.deepEqual(learning, normaliseLearning());
  assert.throws(() => updateLearning({}, { diagnosis: 'autism' }), /Invalid/);
  assert.throws(() => updateLearning({}, { preference: 'slow-learner' }), /supported/);
});

for (const store of chatStores)
  test(`${store.name}: legacy lesson state is discarded and stale guided actions cannot invoke a model`, async () => {
    const legacy = {
      preference: 'brief',
      journey: { topicId: 'daily-routine', stage: 'practice', completed: ['welcome'] },
    };
    const clean = normaliseLearning(legacy);
    assert.equal(clean.preference, 'brief');
    assert.ok(!('journey' in clean));
    let calls = 0;
    const service = engine({
      store,
      plan: async () => {
        calls++;
        throw new Error('Should not invoke');
      },
    });
    try {
      const chat = await service.memory.create('employee');
      for (const action of [
        { type: 'start', topicId: 'daily-routine' },
        { type: 'next' },
        { type: 'finish' },
      ]) {
        await assert.rejects(
          service.ask('employee', chat.id, 'Old lesson request', randomUUID(), undefined, action),
          (error) => error.status === 400 && error.code === 'LEARNING_ACTION_REMOVED',
        );
      }
      assert.equal(calls, 0);
      assert.equal((await service.memory.read('employee', chat.id)).messages.length, 0);
      assert.throws(() => updateLearning(legacy, { stop: true }), /Invalid/);
    } finally {
      await service.close();
    }
  });

for (const store of chatStores)
  test(`${store.name}: the graph applies support to source-grounded answers and saves its format in the same chat`, async () => {
    let instruction = '';
    const service = engine({
      store,
      answer: async (messages) => {
        instruction = messages[0].content;
        return { answer: '1. Identify completed tasks.\n2. List your next steps.', citations: [1] };
      },
    });
    try {
      const chat = await service.memory.create('employee');
      const result = await service.ask(
        'employee',
        chat.id,
        'I do not understand the work report. Explain again.',
        randomUUID(),
      );
      assert.equal(result.learning.format, 'steps');
      assert.match(instruction, /at most 3 short numbered steps/);
      assert.match(instruction, /Never infer, score or label autism/);
      assert.match(instruction, /Example training guidance/);
      assert.equal(result.passages[0].title, 'Synthetic test handbook');
      assert.equal((await service.memory.read('employee', chat.id)).learning.format, 'steps');
      const newChat = await service.memory.create('employee');
      assert.equal(newChat.learning.format, 'standard');
      const reset = await service.settings('employee', chat.id, { reset: true });
      assert.equal(reset.format, 'standard');
      assert.equal((await service.memory.read('employee', chat.id)).learning.format, 'standard');
      assert.equal((await service.memory.read('employee', chat.id)).messages.length, 2);
    } finally {
      await service.close();
    }
  });

for (const store of chatStores)
  test(`${store.name}: open company and onboarding questions use their own queries after a saved lesson`, async () => {
    const queries = [],
      instructions = [],
      questions = [];
    const service = engine({
      store,
      plan: async (messages) => {
        const question = messages.at(-1).content;
        questions.push(question);
        assert.match(messages[0].content, /new company or onboarding question takes priority/);
        return { kind: 'company', query: question, clarification: '' };
      },
      retrieve: async (query) => {
        queries.push(query);
        return [source];
      },
      answer: async (messages) => {
        instructions.push(messages[0].content);
        return { answer: 'Grounded direct answer.', citations: [1] };
      },
    });
    try {
      const chat = await service.memory.create('employee');
      const oldMessages = [
        { id: 'old-u', role: 'user', text: 'Guide me through daily routine.' },
        { id: 'old-a', role: 'assistant', text: 'Let us practice a check-in.' },
      ];
      store.seedHistory(service.memory, chat.id, {
        learning: { journey: { topicId: 'daily-routine', stage: 'practice', completed: [] } },
        messages: oldMessages,
      });
      for (const question of [
        "What is UniVRse's mission?",
        'How do I prepare a work update?',
        'Where is the company office?',
      ]) {
        const answer = await service.ask('employee', chat.id, question, randomUUID());
        assert.equal(answer.answer, 'Grounded direct answer.');
        assert.ok(!('journey' in answer.learning));
      }
      assert.deepEqual(queries, questions);
      assert.equal(queries.length, 3);
      assert.ok(instructions.every((p) => p.includes('Follow a new subject immediately')));
      assert.ok(instructions.every((p) => !p.includes('Current learning topic:')));
      const saved = await service.memory.read('employee', chat.id);
      assert.deepEqual(saved.messages.slice(0, 2), oldMessages);
      assert.equal(saved.messages.length, 8);
    } finally {
      await service.close();
    }
  });

for (const store of chatStores)
  test(`${store.name}: missing sources and provider failures do not invent company answers or save inferred support`, async () => {
    const empty = engine({ store, retrieve: async () => [] });
    try {
      const chat = await empty.memory.create('employee');
      const result = await empty.ask(
        'employee',
        chat.id,
        'What is the office address?',
        randomUUID(),
      );
      assert.match(result.answer, /couldn’t find that information/);
      assert.deepEqual(result.passages, []);
      assert.ok(!('journey' in result.learning));
    } finally {
      await empty.close();
    }
    const fail = engine({
      store,
      answer: async () => {
        throw Object.assign(new Error('provider private information'), { status: 402 });
      },
    });
    try {
      const chat = await fail.memory.create('employee');
      await assert.rejects(fail.ask('employee', chat.id, 'Explain again.', randomUUID()));
      const row = await fail.memory.read('employee', chat.id);
      assert.equal(row.learning.format, 'standard');
      assert.equal(row.messages.length, 0);
    } finally {
      await fail.close();
    }
  });

for (const store of chatStores)
  test(`${store.name}: learning settings endpoint enforces ownership and accepts only presentation and reset controls`, async () => {
    const service = engine({ store }),
      app = createApp({ env: { AI_MODE: 'gemini-chat' }, conversationService: service });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    try {
      const a = await fetch(url + '/api/conversations'),
        b = await fetch(url + '/api/conversations');
      const cookie = a.headers.get('set-cookie').split(';')[0],
        otherCookie = b.headers.get('set-cookie').split(';')[0];
      const created = await fetch(url + '/api/conversations', {
          method: 'POST',
          headers: { cookie },
        }),
        chat = await created.json();
      const change = (body, identity = cookie) =>
        fetch(url + '/api/conversations/' + chat.id + '/learning', {
          method: 'POST',
          headers: { cookie: identity, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      const response = await change({ preference: 'steps' });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).learning.format, 'steps');
      assert.equal((await change({ preference: 'brief' }, otherCookie)).status, 404);
      assert.equal((await change({ diagnosis: 'autism' })).status, 400);
      assert.equal((await change({ reset: 'yes' })).status, 400);
      const config = await (await fetch(url + '/api/config')).json();
      assert.ok(!('learningTopics' in config));
      const stale = await fetch(url + '/api/chat', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Continue old topic',
          taskId: config.tasks[0].id,
          conversationId: chat.id,
          requestId: randomUUID(),
          learningAction: { type: 'next' },
          speechEnabled: false,
        }),
      });
      assert.equal(stale.status, 400);
      assert.equal((await stale.json()).code, 'LEARNING_ACTION_REMOVED');
      const reset = await change({ reset: true });
      assert.equal((await reset.json()).learning.preference, 'auto');
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await service.close();
    }
  });

test('learning prompts keep the same policy access and reject health or employment assessments', () => {
  const prompt = learningInstruction(adaptLearning({}, { question: 'I do not understand.' }));
  assert.match(prompt, /same company guidance and access to all company and onboarding questions/);
  assert.match(prompt, /No sanctions or employment decisions/);
});
