import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AIMessage } from '@langchain/core/messages';
import { createConversationService } from '../../server/gemini-chat-workflow.mjs';
import { chatStores, RETENTION_MS } from './chat-stores.mjs';

// Store limits, expiry and ownership, run against SQLite and Firestore alike.
const source = { title: 'Synthetic handbook', heading: 'Dress', text: 'Business casual.' };
function service(memory) {
  return createConversationService({
    env: {},
    memory,
    retrieve: async () => [source],
    models: {
      plan: { invoke: async () => ({ kind: 'company', query: 'dress code', clarification: '' }) },
      answer: { invoke: async () => ({ answer: 'Business casual.', citations: [1] }) },
      summarize: { invoke: async () => new AIMessage('Earlier dress-code questions.') },
    },
  });
}
const code = (expected, status) => (error) =>
  error.code === expected && (status === undefined || error.status === status);

for (const store of chatStores) {
  test(`${store.name}: an owner keeps at most 30 saved chats, and deleting one frees a place`, async () => {
    const memory = store.create();
    try {
      const chats = [];
      for (let i = 0; i < 30; i++) chats.push(await memory.create('owner'));
      await assert.rejects(memory.create('owner'), code('CHAT_LIMIT', 409));
      assert.equal((await memory.create('someone-else')).title, 'New conversation');
      await memory.erase('owner', chats[0].id);
      const replacement = await memory.create('owner');
      const listed = await memory.list('owner');
      assert.equal(listed.length, 30);
      assert.deepEqual(Object.keys(listed[0]).sort(), ['created', 'id', 'title', 'updated']);
      assert.ok(listed.some((chat) => chat.id === replacement.id));
      assert.ok(!listed.some((chat) => chat.id === chats[0].id));
    } finally {
      await memory.close();
    }
  });

  test(`${store.name}: a chat holds at most 80 questions and stays readable when full`, async () => {
    const memory = store.create(),
      engine = service(memory);
    try {
      const chat = await memory.create('owner');
      const messages = Array.from({ length: 160 }, (_, i) => ({
        id: `seed-${i}`,
        requestId: `seed-${i >> 1}`,
        role: i % 2 ? 'assistant' : 'user',
        text: `message ${i}`,
      }));
      store.seedHistory(memory, chat.id, { learning: {}, messages });
      await assert.rejects(
        engine.ask('owner', chat.id, 'One more question?', randomUUID()),
        code('CHAT_FULL', 409),
      );
      const saved = await memory.read('owner', chat.id);
      assert.equal(saved.messages.length, 160);
      assert.equal(saved.messages[159].text, 'message 159');
      // The full chat is not left locked.
      await memory.setLearning('owner', chat.id, { preference: 'brief' });
    } finally {
      await engine.close();
    }
  });

  test(`${store.name}: chats expire 30 days after their last update and their data is removed`, async () => {
    const memory = store.create(),
      engine = service(memory);
    try {
      const old = await memory.create('owner'),
        recent = await memory.create('owner');
      await engine.ask('owner', old.id, 'What should I wear?', randomUUID());
      await engine.ask('owner', recent.id, 'What should I wear?', randomUUID());
      assert.equal((await memory.supportSummary('owner')).turns, 2);
      assert.ok(store.storedRows(memory, old.id) > 0);
      store.age(memory, old.id, RETENTION_MS + 1000);
      await assert.rejects(memory.read('owner', old.id), code('CHAT_NOT_FOUND', 404));
      await assert.rejects(
        engine.ask('owner', old.id, 'Still there?', randomUUID()),
        code('CHAT_NOT_FOUND', 404),
      );
      assert.deepEqual(
        (await memory.list('owner')).map((chat) => chat.id),
        [recent.id],
      );
      assert.equal((await memory.supportSummary('owner')).turns, 1);
      assert.equal(store.storedRows(memory, old.id), 0);
      // A chat just inside the window is kept.
      store.age(memory, recent.id, RETENTION_MS - 60000);
      assert.equal((await memory.read('owner', recent.id)).messages.length, 2);
    } finally {
      await engine.close();
    }
  });

  test(`${store.name}: another owner cannot read, change or delete a chat, and bad input is rejected`, async () => {
    const memory = store.create(),
      engine = service(memory);
    try {
      const chat = await memory.create('owner'),
        requestId = randomUUID();
      await engine.ask('owner', chat.id, 'What should I wear?', requestId);
      const answerId = requestId + '-a';
      const intruder = [
        () => memory.read('intruder', chat.id),
        () => memory.erase('intruder', chat.id),
        () => memory.acquire('intruder', chat.id),
        () => memory.setLearning('intruder', chat.id, { preference: 'brief' }),
        () => memory.feedback('intruder', chat.id, answerId, 'helpful'),
        () => memory.voiceEvent('intruder', chat.id, answerId),
        () => memory.humanHelp('intruder', chat.id, answerId),
        () => engine.settings('intruder', chat.id, { preference: 'brief' }),
        () => engine.ask('intruder', chat.id, 'What should I wear?', randomUUID()),
        () => memory.read('owner', randomUUID()),
      ];
      for (const attempt of intruder) await assert.rejects(attempt(), code('CHAT_NOT_FOUND', 404));
      await assert.rejects(
        memory.feedback('owner', chat.id, answerId, 'ability-score'),
        code('FEEDBACK_INVALID', 400),
      );
      await assert.rejects(
        memory.feedback('owner', chat.id, requestId + '-u', 'helpful'),
        code('ANSWER_NOT_FOUND', 404),
      );
      await assert.rejects(
        memory.voiceEvent('owner', chat.id, { id: answerId }),
        code('ANSWER_NOT_FOUND', 404),
      );
      await assert.rejects(
        memory.supportSettings('owner', { recording: 'yes' }),
        code('SUPPORT_SETTINGS_INVALID', 400),
      );
      await assert.rejects(
        engine.settings('owner', chat.id, { diagnosis: 'autism' }),
        code('LEARNING_SETTINGS_INVALID', 400),
      );
      const saved = await memory.read('owner', chat.id);
      assert.equal(saved.messages.length, 2);
      assert.equal(saved.messages[1].feedback, undefined);
      assert.equal(saved.title, 'What should I wear?');
      assert.equal((await memory.supportSummary('intruder')).turns, 0);
      assert.equal((await memory.supportSummary('owner')).turns, 1);
    } finally {
      await engine.close();
    }
  });
}
