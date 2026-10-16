import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { createAlyaConversationService } from '../server/alya-brain-service.mjs';
import { createChatMemory } from '../server/saved-conversations.mjs';
import { createGuestWorkspaceStore } from '../server/guest-workspace-store.mjs';
import { createApp } from '../server/api-routes.mjs';
import { presentAnswer } from '../src/avatar/chat-answer-presentation.mjs';
import { answerPresentation } from '../src/avatar/answer-presentation.mjs';

function mockModels(calls = []) {
  return {
    plan: {
      invoke: async (messages) => {
        calls.push(messages);
        const question = messages.at(-1).content;
        return {
          kind: /what about that/i.test(question) ? 'clarify' : 'company',
          query: /leave/i.test(question) ? 'annual leave' : 'working hours',
          clarification: '',
        };
      },
    },
    answer: {
      invoke: async (messages) => {
        const references = JSON.parse(messages[0].content.split('Reference passages: ')[1]);
        return { answer: references[0].text, citations: [1] };
      },
    },
  };
}
const handbook = [
  {
    title: 'Test handbook',
    text: 'Working Hours\nOffice hours are 10 AM to 6 PM.\nAnnual Leave\nRequest leave only after manager approval.',
  },
];
function service(options = {}) {
  return createAlyaConversationService({
    env: {},
    models: mockModels(),
    memory: createChatMemory(':memory:'),
    loadDocuments: async () => handbook,
    ...options,
  });
}

test('the supplied brain files are exact copies of the user-provided package', () => {
  const hashes = JSON.parse(
    readFileSync(new URL('../server/alya-brain/source-hashes.json', import.meta.url), 'utf8'),
  );
  for (const file of hashes) {
    const url = new URL('../server/alya-brain/' + file.File.replaceAll('\\', '/'), import.meta.url);
    assert.equal(
      createHash('sha256').update(readFileSync(url)).digest('hex').toUpperCase(),
      file.Sha256,
      file.File,
    );
  }
});

test('replacement brain keeps transcripts but sends only the current question to its own graph', async () => {
  const calls = [];
  const engine = service({ models: mockModels(calls) });
  try {
    const chat = engine.memory.create('a');
    const first = await engine.ask('a', chat.id, 'What are the working hours?', randomUUID());
    assert.equal(first.mode, 'alya-brain');
    assert.equal(first.passages[0].title, 'Test handbook');
    const next = await engine.ask('a', chat.id, 'What about that?', randomUUID());
    assert.match(next.answer, /tell me a little more/i);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].length, 2);
    assert.equal(calls[1][1].content, 'What about that?');
    assert.equal(engine.memory.read('a', chat.id).messages.length, 4);
    assert.equal(engine.memory.supportSummary('a').turns, 2);
    const reply = presentAnswer(first, 'What are the working hours?');
    assert.ok(answerPresentation(reply).scenes.length);
  } finally {
    engine.close();
  }
});

test('retries are idempotent, conflicting requests are rejected and ownership is enforced', async () => {
  const calls = [];
  const engine = service({ models: mockModels(calls) });
  try {
    const chat = engine.memory.create('a'),
      id = randomUUID();
    await engine.ask('a', chat.id, 'What are the working hours?', id);
    await engine.ask('a', chat.id, 'What are the working hours?', id);
    assert.equal(calls.length, 1);
    assert.equal(engine.memory.supportSummary('a').turns, 1);
    await assert.rejects(engine.ask('a', chat.id, 'What about leave?', id), {
      code: 'REQUEST_CONFLICT',
    });
    await assert.rejects(engine.ask('b', chat.id, 'What are the hours?', randomUUID()), {
      code: 'CHAT_NOT_FOUND',
    });
  } finally {
    engine.close();
  }
});

test('document scopes stay isolated, refresh every new turn and never use revoked content', async () => {
  let revoked = false,
    hours = 'Office hours are 8 AM to 4 PM.';
  const engine = service({
    loadDocumentsForScope: async (owner) => {
      if (revoked) throw new Error('private provider payload');
      return [
        {
          title: owner + ' handbook',
          text: 'Working Hours\n' + (owner === 'a' ? hours : 'Office hours are 10 AM to 6 PM.'),
        },
      ];
    },
  });
  try {
    const a = engine.memory.create('a'),
      b = engine.memory.create('b');
    const [one, two] = await Promise.all([
      engine.ask('a', a.id, 'Working hours?', randomUUID()),
      engine.ask('b', b.id, 'Working hours?', randomUUID()),
    ]);
    assert.match(one.answer, /8 AM/);
    assert.match(two.answer, /10 AM/);
    hours = 'Office hours are 7 AM to 3 PM.';
    assert.match((await engine.ask('a', a.id, 'Working hours?', randomUUID())).answer, /7 AM/);
    revoked = true;
    await assert.rejects(
      engine.ask('a', a.id, 'Working hours?', randomUUID()),
      (error) =>
        error.code === 'ALYA_BRAIN_UNAVAILABLE' && !error.message.includes('private provider'),
    );
    assert.equal(engine.memory.read('a', a.id).messages.length, 4);
  } finally {
    engine.close();
  }
});

test('explicit answer settings are included in this question without replaying old learning state', async () => {
  const calls = [];
  const engine = service({ models: mockModels(calls) });
  try {
    const chat = engine.memory.create('a');
    engine.settings('a', chat.id, { preference: 'steps' });
    const result = await engine.ask('a', chat.id, 'Working hours?', randomUUID());
    assert.match(calls[0][1].content, /step by step/);
    assert.equal(result.learning.format, 'steps');
    assert.equal(engine.memory.read('a', chat.id).messages[0].text, 'Working hours?');
    engine.settings('a', chat.id, { reset: true });
    const next = await engine.ask('a', chat.id, 'Working hours?', randomUUID());
    assert.equal(next.learning.format, 'standard');
    assert.equal(calls[1][1].content, 'Working hours?');
  } finally {
    engine.close();
  }
});

test('missing API keys and interrupted answers never fall back to the previous brain', async () => {
  const engine = service({ models: null });
  try {
    const chat = engine.memory.create('a');
    await assert.rejects(engine.ask('a', chat.id, 'Hello', randomUUID()), {
      code: 'ALYA_BRAIN_NOT_CONFIGURED',
    });
    assert.equal(engine.memory.read('a', chat.id).messages.length, 0);
  } finally {
    engine.close();
  }
  let resolveAnswer, started;
  const began = new Promise((resolve) => {
    started = resolve;
  });
  const models = mockModels();
  models.answer.invoke = () => {
    started();
    return new Promise((resolve) => {
      resolveAnswer = resolve;
    });
  };
  const cancellable = service({ models });
  try {
    const chat = cancellable.memory.create('a'),
      abort = new AbortController();
    const pending = cancellable.ask('a', chat.id, 'Working hours?', randomUUID(), abort.signal);
    await began;
    abort.abort();
    resolveAnswer({ answer: 'Office hours are 10 AM to 6 PM.', citations: [1] });
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(cancellable.memory.read('a', chat.id).messages.length, 0);
    assert.doesNotThrow(() => cancellable.settings('a', chat.id, { reset: true }));
  } finally {
    cancellable.close();
  }
});

async function httpFixture(env = { AI_MODE: 'alya-brain' }, models = mockModels()) {
  const guestStore = createGuestWorkspaceStore({ path: ':memory:', geminiAvailable: true });
  const engine = createAlyaConversationService({
    env,
    models,
    memory: createChatMemory(':memory:'),
    loadDocuments: async () => handbook,
  });
  const app = createApp({
    env,
    conversationService: engine,
    brainModels: models,
    guestModels: models,
    guestStore,
    loadDriveKnowledge: async () => handbook,
  });
  const listener = app.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const url = 'http://127.0.0.1:' + listener.address().port;
  function client(prefix = '') {
    let cookie = '';
    return async (path, body) => {
      const response = await fetch(url + prefix + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      cookie = response.headers.get('set-cookie')?.split(';')[0] || cookie;
      return { status: response.status, body: await response.json() };
    };
  }
  return {
    client,
    close: async () => {
      await new Promise((resolve) => listener.close(resolve));
      app.locals.closeChat();
    },
  };
}

test('main and employee HTTP chats use the supplied brain with protected company sources', async () => {
  const app = await httpFixture({ AI_MODE: 'alya-brain', GOOGLE_DRIVE_FOLDER_ID: 'test-folder' });
  try {
    const main = app.client();
    const config = (await main('/api/config')).body;
    assert.equal(config.aiMode, 'alya-brain');
    assert.equal(config.brain.stateless, true);
    const chat = (await main('/api/conversations', {})).body;
    const answer = await main('/api/chat', {
      taskId: config.tasks[0].id,
      question: 'Working hours?',
      conversationId: chat.id,
      requestId: randomUUID(),
    });
    assert.equal(answer.status, 200);
    assert.equal(answer.body.mode, 'alya-brain');
    assert.ok(answer.body.passages.length);
    const employee = app.client('/api/guest-workspace');
    const workspace = (await employee('')).body;
    const guestId = workspace.guests[0].id;
    assert.equal((await employee('/guests/' + guestId + '/config')).body.aiMode, 'alya-brain');
    const conversation = (await employee('/guests/' + guestId + '/conversations', {})).body;
    const reply = await employee('/guests/' + guestId + '/chat', {
      question: 'Working hours?',
      conversationId: conversation.id,
      requestId: randomUUID(),
    });
    assert.equal(reply.status, 200);
    assert.equal(reply.body.mode, 'alya-brain');
    assert.ok(reply.body.passages.length);
    const outsider = app.client('/api/guest-workspace');
    await outsider('');
    assert.equal((await outsider('/guests/' + guestId + '/config')).status, 404);
  } finally {
    await app.close();
  }
});

test('new-brain HTTP mode exposes safe configuration and errors rather than using legacy Vertex', async () => {
  const app = await httpFixture(
    { AI_MODE: 'alya-brain', GOOGLE_CLOUD_PROJECT: 'legacy-only' },
    null,
  );
  try {
    const main = app.client();
    const config = (await main('/api/config')).body;
    assert.equal(config.aiMode, 'alya-brain');
    assert.equal(config.brain.configured, false);
    const chat = (await main('/api/conversations', {})).body;
    const reply = await main('/api/chat', {
      taskId: config.tasks[0].id,
      question: 'Working hours?',
      conversationId: chat.id,
      requestId: randomUUID(),
    });
    assert.equal(reply.status, 503);
    assert.equal(reply.body.code, 'ALYA_BRAIN_NOT_CONFIGURED');
    const employee = app.client('/api/guest-workspace');
    const workspace = (await employee('')).body,
      guestId = workspace.guests[0].id;
    assert.equal((await employee('/guests/' + guestId + '/config')).body.aiMode, 'alya-brain');
    const conversation = (await employee('/guests/' + guestId + '/conversations', {})).body;
    const result = await employee('/guests/' + guestId + '/chat', {
      question: 'Working hours?',
      conversationId: conversation.id,
      requestId: randomUUID(),
    });
    assert.equal(result.status, 503);
    assert.equal(result.body.code, 'ALYA_BRAIN_NOT_CONFIGURED');
  } finally {
    await app.close();
  }
});
