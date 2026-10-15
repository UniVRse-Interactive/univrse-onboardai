import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { AIMessage } from '@langchain/core/messages';
import { createChatMemory } from '../server/saved-conversations.mjs';
import {
  createConversationService,
  conversationFailure,
  createGeminiModels,
} from '../server/gemini-chat-workflow.mjs';
import {
  createCompanyRetriever,
  sampleSourceTitle,
} from '../server/company-document-retriever.mjs';
import { createVertexSearch, vertexSearchConfig } from '../server/vertex-ai-search.mjs';
import { createApp } from '../server/api-routes.mjs';

// Synthetic Vertex AI Search configuration and chunk response; requests go to a fake fetch.
const searchEnv = {
  GOOGLE_CLOUD_PROJECT: 'test-project',
  VERTEX_SEARCH_LOCATION: 'global',
  VERTEX_SEARCH_ENGINE_ID: 'test-engine',
};
const token = async () => 'test-access-token';
const searchResponse = {
  results: [
    {
      id: 'doc-handbook',
      chunk: {
        id: 'c2',
        content:
          '## Dress Code\nBusiness casual clothing is required. Plain T-shirts are permitted on Fridays only.',
        documentMetadata: { uri: 'gs://test-bucket/policies/Test%20handbook.pdf' },
        pageSpan: { pageStart: 2, pageEnd: 2 },
        chunkMetadata: {
          nextChunks: [
            {
              id: 'c3',
              content: '## Working Hours\nOffice hours are 10 AM to 6 PM Monday to Friday.',
            },
          ],
        },
      },
    },
  ],
};
function fakeSearch(respond = () => Response.json(searchResponse)) {
  const queries = [];
  const retrieve = createCompanyRetriever({
    env: searchEnv,
    getAccessToken: token,
    log: () => {},
    fetchImpl: async (url, options) => {
      queries.push(JSON.parse(options.body).query);
      return respond();
    },
  });
  return { queries, retrieve };
}
const content = (messages) => messages.map((m) => m.content).join('\n');
function models() {
  return {
    plan: {
      invoke: async (messages) => {
        const latest = messages.at(-1).content;
        if (/name/i.test(latest)) return { kind: 'conversation', query: latest, clarification: '' };
        if (/tshirt/i.test(latest)) {
          assert.match(content(messages), /wear/);
          return {
            kind: 'company',
            query: 'T-shirt clothing dress code permission',
            clarification: '',
          };
        }
        return { kind: 'company', query: 'dress code clothing attire', clarification: '' };
      },
    },
    answer: {
      invoke: async (messages) => {
        const latest = messages.at(-1).content;
        if (/name/i.test(latest))
          return {
            answer: /Sam/.test(content(messages))
              ? 'Your name is Sam.'
              : 'I do not know your name yet.',
            citations: [],
          };
        assert.match(messages[0].content, /T-shirts are permitted on Fridays only/);
        return {
          answer: /tshirt/i.test(latest)
            ? 'Plain T-shirts are permitted on Fridays only.'
            : 'Business casual clothing is required.',
          citations: [1],
        };
      },
    },
    summarize: { invoke: async () => new AIMessage('The user said their name is Sam.') },
  };
}

test("Gemini's contextual rewrite is the Vertex AI Search query and answers keep the source conditions", async () => {
  const { queries, retrieve } = fakeSearch();
  const service = createConversationService({
    env: {},
    models: models(),
    memory: createChatMemory(':memory:'),
    retrieve,
  });
  try {
    const chat = service.memory.create('person-a');
    await service.ask('person-a', chat.id, 'What should I wear?', randomUUID());
    const result = await service.ask('person-a', chat.id, 'if i wear the tshirt', randomUUID());
    assert.deepEqual(queries, [
      'dress code clothing attire',
      'T-shirt clothing dress code permission',
    ]);
    assert.match(result.answer, /Fridays only/);
    assert.deepEqual(result.passages, [
      {
        id: 1,
        title: 'Test handbook.pdf',
        heading: 'Dress Code · page 2',
        text:
          searchResponse.results[0].chunk.content +
          '\n\n' +
          searchResponse.results[0].chunk.chunkMetadata.nextChunks[0].content,
      },
    ]);
    assert.equal(result.source, 'Test handbook.pdf');
    assert.ok(!JSON.stringify(result).includes('gs://'));
    assert.equal(service.memory.read('person-a', chat.id).messages.length, 4);
  } finally {
    service.close();
  }
});

test('conversation context survives reopening the database, and new chats are separate', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'alya-memory-')),
    path = join(temp, 'memory.sqlite');
  let service = createConversationService({
    env: {},
    models: models(),
    memory: createChatMemory(path),
  });
  const chat = service.memory.create('person-a');
  try {
    await service.ask('person-a', chat.id, 'My name is Sam.', randomUUID());
    service.settings('person-a', chat.id, { preference: 'steps' });
    service.close();
    service = createConversationService({
      env: {},
      models: models(),
      memory: createChatMemory(path),
    });
    assert.equal(service.memory.read('person-a', chat.id).learning.preference, 'steps');
    assert.equal(service.memory.supportSummary('person-a').turns, 1);
    const result = await service.ask('person-a', chat.id, 'What is my name?', randomUUID());
    assert.equal(result.answer, 'Your name is Sam.');
    assert.equal(service.memory.read('person-a', chat.id).messages.length, 4);
    const newChat = service.memory.create('person-a');
    assert.equal(
      (await service.ask('person-a', newChat.id, 'What is my name?', randomUUID())).answer,
      'I do not know your name yet.',
    );
    assert.throws(
      () => service.memory.read('person-b', chat.id),
      (error) => error.status === 404,
    );
    service.memory.erase('person-a', chat.id);
    assert.throws(
      () => service.memory.read('person-a', chat.id),
      (error) => error.status === 404,
    );
    assert.equal(
      await service.memory.checkpointer.get({ configurable: { thread_id: chat.id } }),
      undefined,
    );
  } finally {
    service.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test('retrying an answered request does not bill the model twice; failed turns are not in visible memory', async () => {
  let calls = 0,
    fail = false;
  const fake = models();
  const original = fake.plan.invoke;
  fake.plan.invoke = async (messages) => {
    calls++;
    if (fail) throw Object.assign(new Error('provider-private-key'), { status: 402 });
    return original(messages);
  };
  const service = createConversationService({
    env: {},
    models: fake,
    memory: createChatMemory(':memory:'),
  });
  try {
    const chat = service.memory.create('person'),
      requestId = randomUUID();
    await service.ask('person', chat.id, 'My name is Sam.', requestId);
    await service.ask('person', chat.id, 'My name is Sam.', requestId);
    assert.equal(calls, 1);
    await assert.rejects(
      service.ask('person', chat.id, 'A different question', requestId),
      (e) => e.code === 'REQUEST_CONFLICT',
    );
    fail = true;
    await assert.rejects(service.ask('person', chat.id, 'What is my name?', randomUUID()));
    assert.equal(service.memory.read('person', chat.id).messages.length, 2);
    fail = false;
    assert.equal(
      (await service.ask('person', chat.id, 'What is my name?', randomUUID())).answer,
      'Your name is Sam.',
    );
  } finally {
    service.close();
  }
});

test('missing evidence withholds unsupported company answers and invalid citation IDs are rejected', async () => {
  const fake = models();
  let answerCalls = 0;
  fake.answer.invoke = async () => {
    answerCalls++;
    return { answer: 'An invented policy.', citations: [] };
  };
  const empty = fakeSearch(() => Response.json({ totalSize: 0 }));
  const service = createConversationService({
    env: {},
    models: fake,
    memory: createChatMemory(':memory:'),
    retrieve: empty.retrieve,
  });
  try {
    const chat = service.memory.create('person');
    const result = await service.ask('person', chat.id, 'What should I wear?', randomUUID());
    assert.match(result.answer, /couldn’t find.*add a little detail.*check with HR/);
    assert.equal(result.source, 'No confirmed company source');
    assert.deepEqual(result.passages, []);
    assert.equal(empty.queries.length, 1);
    assert.equal(answerCalls, 0);
  } finally {
    service.close();
  }
  const invalid = models();
  invalid.answer.invoke = async () => ({ answer: 'Invented', citations: [99] });
  const service2 = createConversationService({
    env: {},
    models: invalid,
    memory: createChatMemory(':memory:'),
    retrieve: fakeSearch().retrieve,
  });
  try {
    const chat = service2.memory.create('person');
    await assert.rejects(
      service2.ask('person', chat.id, 'What should I wear?', randomUUID()),
      /Invalid citations/,
    );
    assert.equal(service2.memory.read('person', chat.id).messages.length, 0);
  } finally {
    service2.close();
  }
});

test('long conversations summarise earlier turns and still remember user context', async () => {
  const fake = models();
  let summaries = 0;
  const plan = fake.plan.invoke;
  fake.plan.invoke = async (messages) => {
    assert.equal(messages[1]._getType(), 'human');
    return plan(messages);
  };
  fake.summarize.invoke = async () => {
    summaries++;
    return new AIMessage('The user said their name is Sam.');
  };
  const service = createConversationService({
    env: {},
    models: fake,
    memory: createChatMemory(':memory:'),
  });
  try {
    const chat = service.memory.create('person');
    await service.ask('person', chat.id, 'My name is Sam.', randomUUID());
    for (let i = 0; i < 15; i++)
      assert.equal(
        (await service.ask('person', chat.id, 'What is my name?', randomUUID())).answer,
        'Your name is Sam.',
      );
    assert.ok(summaries > 0);
    assert.equal(service.memory.read('person', chat.id).messages.length, 32);
  } finally {
    service.close();
  }
});

test('API browser sessions own their saved chats; a guessed ID and cross-origin mutations grant no access', async () => {
  const service = createConversationService({
    env: {},
    models: models(),
    memory: createChatMemory(':memory:'),
  });
  const app = createApp({ env: { AI_MODE: 'gemini-chat' }, conversationService: service });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const first = await fetch(url + '/api/conversations'),
      second = await fetch(url + '/api/conversations');
    const cookieA = first.headers.get('set-cookie').split(';')[0],
      cookieB = second.headers.get('set-cookie').split(';')[0];
    assert.match(first.headers.get('set-cookie'), /HttpOnly/);
    assert.match(first.headers.get('set-cookie'), /SameSite=Strict/);
    const created = await fetch(url + '/api/conversations', {
        method: 'POST',
        headers: { cookie: cookieA },
      }),
      chat = await created.json();
    assert.equal(created.status, 201);
    const inaccessible = await fetch(url + '/api/conversations/' + chat.id, {
      headers: { cookie: cookieB },
    });
    assert.equal(inaccessible.status, 404);
    const body = {
      question: 'My name is Sam.',
      taskId: 'company-resources',
      conversationId: chat.id,
      requestId: randomUUID(),
    };
    const send = await fetch(url + '/api/chat', {
      method: 'POST',
      headers: { cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(send.status, 200);
    const denied = await fetch(url + '/api/chat', {
      method: 'POST',
      headers: { cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, requestId: randomUUID() }),
    });
    assert.equal(denied.status, 404);
    const cross = await fetch(url + '/api/conversations/' + chat.id, {
      method: 'DELETE',
      headers: { cookie: cookieA, Origin: 'https://other.example' },
    });
    assert.equal(cross.status, 403);
    const erased = await fetch(url + '/api/conversations/' + chat.id, {
      method: 'DELETE',
      headers: { cookie: cookieA },
    });
    assert.equal(erased.status, 204);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    service.close();
  }
});

test('billing and provider errors contain actionable messages without raw secrets', () => {
  const failure = conversationFailure(
    Object.assign(new Error('private-api-key-value'), { status: 402 }),
  );
  assert.equal(failure.code, 'GEMINI_CREDIT_REQUIRED');
  assert.equal(failure.status, 402);
  assert.ok(!JSON.stringify(failure).includes('private-api-key-value'));
});

test('cancelling a turn prevents late memory writes, and simultaneous turns cannot overwrite each other', async () => {
  const fake = models();
  let resume, started;
  const waiting = new Promise((resolve) => {
    started = resolve;
  });
  fake.plan.invoke = async () => {
    started();
    await new Promise((resolve) => {
      resume = resolve;
    });
    return { kind: 'conversation', query: 'name', clarification: '' };
  };
  fake.answer.invoke = async () => ({ answer: 'Your name is Sam.', citations: [] });
  const service = createConversationService({
    env: {},
    models: fake,
    memory: createChatMemory(':memory:'),
  });
  try {
    const chat = service.memory.create('person'),
      abort = new AbortController();
    const turn = service.ask('person', chat.id, 'My name is Sam.', randomUUID(), abort.signal);
    // Install the rejection handler before the signal can stop the graph.
    const rejected = assert.rejects(turn);
    await waiting;
    await assert.rejects(
      service.ask('person', chat.id, 'What is my name?', randomUUID()),
      (e) => e.code === 'CHAT_BUSY',
    );
    assert.throws(
      () => service.memory.erase('person', chat.id),
      (e) => e.code === 'CHAT_BUSY',
    );
    abort.abort();
    resume();
    await rejected;
    assert.equal(service.memory.read('person', chat.id).messages.length, 0);
  } finally {
    service.close();
  }
});

test('chat models are built for Vertex AI with project, location and model passed through', () => {
  const m = createGeminiModels({
    GOOGLE_CLOUD_PROJECT: 'test-project',
    GOOGLE_CLOUD_LOCATION: 'us-central1',
    GEMINI_MODEL: 'gemini-test-model',
    GOOGLE_API_KEY: 'must-be-ignored',
  });
  const chat = m.summarize;
  assert.equal(chat.platform, 'gcp');
  assert.equal(chat.isVertexExpress, false);
  assert.equal(chat.location, 'us-central1');
  assert.equal(chat.model, 'gemini-test-model');
  assert.equal(chat.endpoint, 'us-central1-aiplatform.googleapis.com');
  assert.equal(chat.apiClient.hasApiKey(), false);
  assert.equal(chat.params.googleAuthOptions.projectId, 'test-project');
  assert.equal(createGeminiModels({ GOOGLE_CLOUD_PROJECT: 'p' }).summarize.location, 'global');
  assert.equal(
    createGeminiModels({ GOOGLE_CLOUD_PROJECT: 'p' }).summarize.endpoint,
    'aiplatform.googleapis.com',
  );
});

test('chat without GOOGLE_CLOUD_PROJECT returns 503 GEMINI_NOT_CONFIGURED', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vertex-unconfigured-'));
  const service = createConversationService({
    env: { CHAT_DATABASE_PATH: join(dir, 'chat.sqlite') },
  });
  try {
    await assert.rejects(service.ask('owner', randomUUID(), 'hello', randomUUID()), (error) => {
      const failure = conversationFailure(error);
      return failure.status === 503 && failure.code === 'GEMINI_NOT_CONFIGURED';
    });
    assert.throws(
      () => createGeminiModels({}),
      (e) => e.code === 'GEMINI_NOT_CONFIGURED',
    );
  } finally {
    await service.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('search failures during a chat turn return safe errors and leave the saved chat unchanged', async () => {
  const slow = createVertexSearch({
    config: vertexSearchConfig(searchEnv),
    getAccessToken: token,
    log: () => {},
    timeoutMs: 20,
    fetchImpl: (url, { signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      ),
  });
  for (const [retrieve, code, status] of [
    [
      fakeSearch(() => new Response('private provider details', { status: 403 })).retrieve,
      'SEARCH_ACCESS_DENIED',
      503,
    ],
    [
      fakeSearch(() => new Response('private provider details', { status: 429 })).retrieve,
      'SEARCH_RATE_LIMIT',
      429,
    ],
    [
      fakeSearch(() => new Response('private provider details', { status: 500 })).retrieve,
      'SEARCH_UNAVAILABLE',
      503,
    ],
    [(query, config) => slow(query, { signal: config?.signal }), 'SEARCH_TIMEOUT', 504],
  ]) {
    const service = createConversationService({
      env: {},
      models: models(),
      memory: createChatMemory(':memory:'),
      retrieve,
    });
    try {
      const chat = service.memory.create('person');
      await assert.rejects(
        service.ask('person', chat.id, 'What should I wear?', randomUUID()),
        (error) => {
          const failure = conversationFailure(error);
          assert.equal(failure.code, code);
          assert.equal(failure.status, status);
          assert.ok(!JSON.stringify(failure).includes('private provider'));
          assert.ok(!JSON.stringify(failure).includes('test-access-token'));
          return true;
        },
      );
      assert.equal(service.memory.read('person', chat.id).messages.length, 0);
    } finally {
      service.close();
    }
  }
});

test('chat answers over HTTP name the source file and section, never a gs:// URI', async () => {
  const service = createConversationService({
    env: {},
    models: models(),
    memory: createChatMemory(':memory:'),
    retrieve: fakeSearch().retrieve,
  });
  const app = createApp({ env: { AI_MODE: 'gemini-chat' }, conversationService: service });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await fetch(url + '/api/conversations', { method: 'POST' });
    const cookie = created.headers.get('set-cookie').split(';')[0],
      chat = await created.json();
    const response = await fetch(url + '/api/chat', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'What should I wear?',
        taskId: 'company-resources',
        conversationId: chat.id,
        requestId: randomUUID(),
      }),
    });
    const text = await response.text(),
      result = JSON.parse(text);
    assert.equal(response.status, 200);
    assert.equal(result.mode, 'gemini-memory');
    assert.equal(result.source, 'Test handbook.pdf');
    assert.equal(result.passages[0].title, 'Test handbook.pdf');
    assert.equal(result.passages[0].heading, 'Dress Code · page 2');
    assert.ok(!text.includes('gs://'));
    assert.ok(!text.includes('test-bucket'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    service.close();
  }
});

test('without a search engine, gemini-chat answers from the labelled sample guide', async () => {
  let reference;
  const fake = models();
  fake.plan.invoke = async () => ({
    kind: 'company',
    query: 'finish onboarding quiz part 1 next step',
    clarification: '',
  });
  fake.answer.invoke = async (messages) => {
    reference = messages[0].content;
    return {
      answer: 'Sample guide: inform HR after Part 1. Please confirm with HR.',
      citations: [1],
    };
  };
  const service = createConversationService({
    env: { GOOGLE_CLOUD_PROJECT: 'test-project' },
    models: fake,
    memory: createChatMemory(':memory:'),
  });
  try {
    const chat = service.memory.create('person');
    const result = await service.ask(
      'person',
      chat.id,
      'I finished the quiz. Now what?',
      randomUUID(),
    );
    assert.match(reference, /Unapproved sample guidance/);
    assert.equal(result.passages.length, 1);
    assert.equal(result.passages[0].title, sampleSourceTitle);
    assert.equal(result.source, sampleSourceTitle);
  } finally {
    service.close();
  }
});
