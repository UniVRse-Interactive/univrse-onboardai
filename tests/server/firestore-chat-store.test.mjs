import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { AIMessage } from '@langchain/core/messages';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { createConversationService } from '../../server/gemini-chat-workflow.mjs';
import { createApp } from '../../server/api-routes.mjs';
import { createChatStore, describeChatStorage } from '../../server/chat-store.mjs';
import { busyMessages } from '../../server/chat-errors.mjs';
import { FirestoreSaver } from '../../server/firestore-checkpointer.mjs';
import { firestoreReason, storageCode } from '../../server/firestore-client.mjs';
import {
  createFirestoreChatMemory,
  ownerDocId,
  RETENTION_MS,
  TURN_LEASE_MS,
} from '../../server/firestore-chat-memory.mjs';
import { FakeFirestore } from './fake-firestore.mjs';

const owner = 'a'.repeat(64);
const DAY = 24 * 60 * 60 * 1000;
const models = () => ({
  plan: { invoke: async () => ({ kind: 'company', query: 'dress code', clarification: '' }) },
  answer: { invoke: async () => ({ answer: 'Business casual clothing.', citations: [1] }) },
  summarize: { invoke: async () => new AIMessage('Earlier dress-code questions.') },
});
const retrieve = async () => [
  { title: 'Synthetic handbook', heading: 'Dress', text: 'Business casual clothing.' },
];
const memoryOn = (firestore, options = {}) =>
  createFirestoreChatMemory({ firestore, log: () => {}, ...options });
const serviceOn = (memory) =>
  createConversationService({ env: {}, models: models(), retrieve, memory });
const turnMessages = (requestId, question = 'Q') => [
  { id: requestId + '-u', requestId, role: 'user', text: question },
  { id: requestId + '-a', requestId, role: 'assistant', text: 'A', result: { answer: 'A' } },
];
const keys = (data) => Object.keys(data).sort();

test('Firestore layout: chats, messages, support data and graph state use the documented collections and fields', async () => {
  const fake = new FakeFirestore();
  const memory = memoryOn(fake),
    service = serviceOn(memory);
  const chat = await memory.create(owner),
    requestId = randomUUID();
  await service.ask(owner, chat.id, 'PRIVATE-QUESTION What should I wear?', requestId);
  await memory.feedback(owner, chat.id, requestId + '-a', 'helpful');
  const paths = fake.paths();
  assert.deepEqual(
    [...new Set(paths.map((path) => path.split('/')[0]))],
    ['chatCheckpoints', 'conversations', 'supportPreferences'],
  );
  const record = fake.read(`conversations/${chat.id}`);
  assert.deepEqual(keys(record), [
    'created',
    'learning',
    'messageCount',
    'owner',
    'support',
    'title',
    'turnToken',
    'turnUntil',
    'updated',
  ]);
  assert.equal(record.owner, owner);
  assert.equal(record.messageCount, 2);
  assert.equal(record.turnToken, null);
  assert.equal(record.title, 'PRIVATE-QUESTION What should I wear?');
  assert.deepEqual(fake.paths(`conversations/${chat.id}/`), [
    `conversations/${chat.id}/messages/0000`,
    `conversations/${chat.id}/messages/0001`,
  ]);
  const answer = fake.read(`conversations/${chat.id}/messages/0001`);
  assert.deepEqual(keys(answer), ['data', 'id', 'role']);
  assert.equal(answer.id, requestId + '-a');
  assert.equal(JSON.parse(answer.data).feedback, 'helpful');
  // Support observations: one entry per (kind, answer), labels only.
  const support = JSON.parse(record.support);
  assert.deepEqual(Object.keys(support).sort(), [`feedback:${requestId}-a`, `turn:${requestId}-a`]);
  assert.deepEqual(support[`feedback:${requestId}-a`], {
    kind: 'feedback',
    messageId: requestId + '-a',
    data: { rating: 'helpful' },
    updated: record.updated,
  });
  assert.deepEqual(keys(support[`turn:${requestId}-a`].data), ['card', 'format', 'request']);
  assert.ok(!record.support.includes('PRIVATE'));
  const preference = fake.read(`supportPreferences/${ownerDocId(owner)}`);
  assert.deepEqual(keys(preference), ['owner', 'recording', 'revision', 'updated']);
  // Only the latest checkpoint and its parent are kept after an answer.
  const heads = fake.paths(`chatCheckpoints/${chat.id}/checkpoints/`);
  assert.equal(heads.length, 2);
  for (const path of heads)
    assert.deepEqual(keys(fake.read(path)), [
      'checkpointId',
      'ns',
      'parentId',
      'parts',
      'payload',
      'type',
      'updated',
    ]);
  for (const path of fake.paths(`chatCheckpoints/${chat.id}/writes/`))
    assert.deepEqual(keys(fake.read(path)), [
      'channel',
      'checkpointId',
      'idx',
      'ns',
      'parts',
      'payload',
      'taskId',
      'type',
      'updated',
    ]);
  await memory.erase(owner, chat.id);
  assert.deepEqual(fake.paths('conversations/'), []);
  assert.deepEqual(fake.paths('chatCheckpoints/'), []);
  await service.close();
});

test('Firestore: a summary reads one document per chat, however many answers were observed', async () => {
  const fake = new FakeFirestore();
  const memory = memoryOn(fake),
    service = serviceOn(memory);
  const chats = [await memory.create(owner), await memory.create(owner)];
  for (const chat of chats)
    for (let i = 0; i < 6; i++)
      await service.ask(owner, chat.id, 'What should I wear?', randomUUID());
  const before = { ...fake.calls };
  const summary = await memory.supportSummary(owner);
  assert.equal(summary.turns, 12);
  assert.equal(summary.conversations, 2);
  // One preference read and one query over this owner's chat documents.
  assert.equal(fake.calls.get - (before.get || 0), 1);
  assert.equal(fake.calls.query - (before.query || 0), 1);
  await service.close();
});

test('Firestore: a save that commits after its deadline is returned to a retry with the same request ID', async () => {
  const fake = new FakeFirestore();
  const memory = memoryOn(fake, { timeoutMs: 50 });
  let modelCalls = 0;
  const fakeModels = models();
  fakeModels.answer.invoke = async () => {
    modelCalls++;
    // The next transaction is this answer's save: its commit lands after the deadline.
    fake.fail(0, { delayMs: 150, only: ['transaction-commit'] });
    return { answer: 'Business casual clothing.', citations: [1] };
  };
  const service = createConversationService({ env: {}, models: fakeModels, retrieve, memory });
  const chat = await memory.create(owner),
    requestId = randomUUID();
  await assert.rejects(
    service.ask(owner, chat.id, 'What should I wear?', requestId),
    (error) => error.code === 'STORAGE_TIMEOUT' && error.status === 504,
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  const retry = await service.ask(owner, chat.id, 'What should I wear?', requestId);
  assert.equal(retry.answer, 'Business casual clothing.');
  assert.equal(modelCalls, 1);
  assert.equal((await memory.read(owner, chat.id)).messages.length, 2);
  assert.equal(fake.read(`conversations/${chat.id}`).turnToken, null);
  await service.close();
});

test('Firestore: expired and deleted chats are hidden at once; the sweep removes them at most once a minute', async () => {
  let clock = Date.parse('2026-10-15T00:00:00Z');
  const fake = new FakeFirestore();
  const memory = memoryOn(fake, { now: () => clock }),
    service = serviceOn(memory);
  const old = await memory.create(owner);
  await service.ask(owner, old.id, 'What should I wear?', randomUUID());
  clock += 10 * DAY;
  const recent = await memory.create(owner);
  await service.ask(owner, recent.id, 'What should I wear?', randomUUID());
  clock += 20 * DAY + 1000;
  await assert.rejects(memory.read(owner, old.id), (e) => e.code === 'CHAT_NOT_FOUND');
  // More than a minute since the last sweep: this list removes the old chat.
  assert.deepEqual(
    (await memory.list(owner)).map((chat) => chat.id),
    [recent.id],
  );
  assert.deepEqual(fake.paths(`conversations/${old.id}`), []);
  assert.deepEqual(fake.paths(`chatCheckpoints/${old.id}/`), []);
  // Within the minute, a newly expired chat is hidden but not yet removed.
  const record = fake.read(`conversations/${recent.id}`);
  fake.write(`conversations/${recent.id}`, { ...record, updated: clock - RETENTION_MS - 1 });
  clock += 1000;
  assert.deepEqual(await memory.list(owner), []);
  assert.equal((await memory.supportSummary(owner)).turns, 0);
  assert.ok(fake.paths(`conversations/${recent.id}`).length > 0);
  clock += 60000;
  await memory.list(owner);
  assert.deepEqual(fake.paths(), [`supportPreferences/${ownerDocId(owner)}`]);
  // An interrupted delete hides the chat; retrying finishes it, as does the sweep.
  for (const finish of ['retry', 'sweep']) {
    const chat = await memory.create(owner);
    await service.ask(owner, chat.id, 'What should I wear?', randomUUID());
    fake.fail(14, { only: ['commit'] });
    await assert.rejects(memory.erase(owner, chat.id), (e) => e.code === 'STORAGE_UNAVAILABLE');
    await assert.rejects(memory.read(owner, chat.id), (e) => e.code === 'CHAT_NOT_FOUND');
    assert.deepEqual(await memory.list(owner), []);
    assert.ok(fake.paths(`conversations/${chat.id}/messages/`).length > 0);
    if (finish === 'retry') await memory.erase(owner, chat.id);
    else {
      clock += 60000;
      await memory.list(owner);
    }
    assert.deepEqual(fake.paths(`conversations/${chat.id}`), []);
    assert.deepEqual(fake.paths(`chatCheckpoints/${chat.id}/`), []);
  }
  await service.close();
});

test('Firestore: an answer leases its chat across server instances until it is saved, released or expires', async () => {
  let clock = Date.parse('2026-10-15T00:00:00Z');
  const fake = new FakeFirestore();
  const a = memoryOn(fake, { now: () => clock }),
    b = memoryOn(fake.connect(), { now: () => clock });
  const busy = (message) => (e) =>
    e.code === 'CHAT_BUSY' && e.status === 409 && e.message === message;
  const chat = await a.create(owner);
  const stale = await a.acquire(owner, chat.id);
  await assert.rejects(b.acquire(owner, chat.id), busy(busyMessages.answer));
  await assert.rejects(b.erase(owner, chat.id), busy(busyMessages.erase));
  await assert.rejects(b.setLearning(owner, chat.id, {}), busy(busyMessages.learning));
  // Instance a stalls or stops; its lease runs out.
  clock += TURN_LEASE_MS + 1;
  const current = await b.acquire(owner, chat.id);
  await assert.rejects(stale.save(turnMessages(randomUUID()), {}), busy(busyMessages.answer));
  await stale.release(); // Must not end b's lease.
  await assert.rejects(a.acquire(owner, chat.id), busy(busyMessages.answer));
  await current.save(turnMessages(randomUUID(), 'Kept question'), {});
  assert.deepEqual(
    (await a.read(owner, chat.id)).messages.map((m) => m.text),
    ['Kept question', 'A'],
  );
  // Saving ended the lease; a released turn frees the chat too.
  const next = await a.acquire(owner, chat.id);
  await next.release();
  await (await b.acquire(owner, chat.id)).release();
  // Two instances racing for the same chat: exactly one gets it.
  const results = await Promise.allSettled([a.acquire(owner, chat.id), b.acquire(owner, chat.id)]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
});

test('Firestore failures reach the browser as fixed messages and are logged without chat text', async () => {
  const fake = new FakeFirestore(),
    logs = [];
  const memory = createFirestoreChatMemory({
    firestore: fake,
    log: (line) => logs.push(line),
    timeoutMs: 50,
    sweepIntervalMs: Infinity,
  });
  const service = serviceOn(memory);
  const app = createApp({ env: { AI_MODE: 'gemini-chat' }, conversationService: service });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await fetch(url + '/api/conversations', { method: 'POST' });
    const cookie = created.headers.get('set-cookie').split(';')[0],
      chat = await created.json();
    for (const [grpc, status, expected, options = {}] of [
      [7, 503, 'STORAGE_ACCESS_DENIED'],
      [16, 503, 'STORAGE_ACCESS_DENIED'],
      [5, 503, 'STORAGE_NOT_FOUND'],
      [8, 429, 'STORAGE_RATE_LIMIT'],
      [14, 503, 'STORAGE_UNAVAILABLE'],
      [9, 503, 'STORAGE_UNAVAILABLE'],
      [4, 504, 'STORAGE_TIMEOUT'],
      [0, 504, 'STORAGE_TIMEOUT', { hang: true }],
    ]) {
      fake.fail(grpc, { only: ['query'], ...options });
      const response = await fetch(url + '/api/conversations', { headers: { cookie } });
      const text = await response.text();
      assert.equal(response.status, status, expected);
      assert.equal(JSON.parse(text).code, expected);
      assert.ok(!/private|path|Injected/i.test(text));
      fake.heal();
    }
    // A database failure during an answer leaves the chat unchanged and unlocked.
    fake.fail(14, { only: ['commit'] });
    const ask = (question) =>
      fetch(url + '/api/chat', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          taskId: 'company-resources',
          conversationId: chat.id,
          requestId: randomUUID(),
        }),
      });
    const failed = await ask('PRIVATE-QUESTION about clothing');
    assert.equal(failed.status, 503);
    assert.equal((await failed.json()).code, 'STORAGE_UNAVAILABLE');
    fake.heal();
    const saved = await fetch(`${url}/api/conversations/${chat.id}`, { headers: { cookie } });
    assert.equal((await saved.json()).messages.length, 0);
    assert.equal((await ask('What should I wear?')).status, 200);
    assert.ok(logs.length >= 9);
    for (const line of logs) {
      assert.match(
        line,
        /^Firestore request failed: \{"operation":"[a-z ]+","code":"STORAGE_[A-Z_]+","reason":"[A-Z_0-9]+"\}$/,
      );
      assert.ok(!line.includes('PRIVATE') && !line.includes(chat.id) && !line.includes(owner));
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await service.close();
  }
  // REST errors may carry an HTTP status instead of a gRPC code.
  assert.equal(storageCode(firestoreReason({ code: 403 })), 'STORAGE_ACCESS_DENIED');
  assert.equal(storageCode(firestoreReason({ code: 429 })), 'STORAGE_RATE_LIMIT');
  assert.equal(storageCode(firestoreReason(new TypeError('x'))), 'STORAGE_UNAVAILABLE');
});

test('Firestore: conversation IDs that are not server-made UUIDs never address a document', async () => {
  const fake = new FakeFirestore();
  const memory = memoryOn(fake),
    service = serviceOn(memory);
  const chat = await memory.create(owner),
    requestId = randomUUID();
  await service.ask(owner, chat.id, 'What should I wear?', requestId);
  const before = JSON.stringify(fake.calls);
  for (const id of [
    `${chat.id}/messages/0000`,
    '../supportPreferences',
    chat.id.toUpperCase(),
    '',
    'x'.repeat(36),
    42,
  ]) {
    await assert.rejects(memory.read(owner, id), (e) => e.code === 'CHAT_NOT_FOUND');
    await assert.rejects(memory.erase(owner, id), (e) => e.code === 'CHAT_NOT_FOUND');
    await assert.rejects(memory.acquire(owner, id), (e) => e.code === 'CHAT_NOT_FOUND');
    await assert.rejects(
      memory.feedback(owner, id, requestId + '-a', 'helpful'),
      (e) => e.code === 'CHAT_NOT_FOUND',
    );
  }
  assert.equal(JSON.stringify(fake.calls), before);
  assert.equal((await memory.read(owner, chat.id)).messages.length, 2);
  await service.close();
});

test('FIRESTORE_DATABASE_ID selects Firestore, blank keeps SQLite, and a missing project is a safe 503', async () => {
  const sqlite = createChatStore({ CHAT_DATABASE_PATH: ':memory:' });
  assert.ok(sqlite.checkpointer instanceof SqliteSaver);
  await sqlite.close();
  const blank = createChatStore({ FIRESTORE_DATABASE_ID: '  ', CHAT_DATABASE_PATH: ':memory:' });
  assert.ok(blank.checkpointer instanceof SqliteSaver);
  await blank.close();
  // Created lazily: no Google call is made until a chat request needs one.
  const firestore = createChatStore({
    FIRESTORE_DATABASE_ID: '(default)',
    GOOGLE_CLOUD_PROJECT: 'test-project',
  });
  assert.ok(firestore.checkpointer instanceof FirestoreSaver);
  await firestore.close();
  assert.throws(
    () => createChatStore({ FIRESTORE_DATABASE_ID: '(default)' }),
    (e) => e.code === 'STORAGE_NOT_CONFIGURED' && e.status === 503,
  );
  assert.equal(describeChatStorage({}), 'SQLite file .cache/chat/conversations.sqlite');
  assert.equal(
    describeChatStorage({ FIRESTORE_DATABASE_ID: '(default)', GOOGLE_CLOUD_PROJECT: 'p' }),
    'Firestore database (default) in p',
  );
  const app = createApp({ env: { AI_MODE: 'gemini-chat', FIRESTORE_DATABASE_ID: '(default)' } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/conversations`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, 'STORAGE_NOT_CONFIGURED');
    assert.match(body.error, /GOOGLE_CLOUD_PROJECT/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
