import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createApp } from '../server/api-routes.mjs';
import {
  createGuestWorkspaceStore,
  guestWorkspaceLifetime,
} from '../server/guest-workspace-store.mjs';
import { onboardingSnapshot, checkInStatus } from '../src/access/hr-report-insights.mjs';

const guidance =
  'Working Hours\nOffice hours are 10 AM to 6 PM Monday to Friday.\nDress Code\nPlain T-shirts are permitted on Fridays only.';
async function server(models = null, options = {}) {
  const store = createGuestWorkspaceStore({ path: ':memory:', geminiAvailable: !!models });
  const app = createApp({
    env: options.env || {},
    guestStore: store,
    guestModels: models,
    getAccessToken: async () => 'test-token',
    fetchImpl:
      options.fetchImpl ||
      (async (url) => {
        throw new Error('No Google request expected: ' + url);
      }),
  });
  const listener = app.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const url = 'http://127.0.0.1:' + listener.address().port;
  return {
    store,
    client() {
      let cookie = '';
      return async (path = '', options = {}) => {
        const response = await fetch(url + '/api/guest-workspace' + path, {
          ...options,
          headers: { 'Content-Type': 'application/json', cookie, ...options.headers },
          body:
            options.body === undefined
              ? undefined
              : Buffer.isBuffer(options.body)
                ? options.body
                : JSON.stringify(options.body),
        });
        cookie = response.headers.get('set-cookie')?.split(';')[0] || cookie;
        const body = response.status === 204 ? null : await response.json();
        return { status: response.status, body, headers: response.headers };
      };
    },
    async close() {
      await new Promise((r) => listener.close(r));
      await app.locals.closeChat();
    },
  };
}
const upload = (client, name = 'guide.txt', text = guidance) =>
  client('/documents', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(name),
    },
    body: Buffer.from(text),
  });
const createChat = (client, id) => client('/guests/' + id + '/conversations', { method: 'POST' });
const ask = (client, guestId, chatId, question, requestId = randomUUID()) =>
  client('/guests/' + guestId + '/chat', {
    method: 'POST',
    body: { question, conversationId: chatId, requestId },
  });

test('upload → source answer → feedback produces a live, separate report for each guest', async () => {
  const s = await server(),
    client = s.client();
  try {
    const first = await client();
    assert.equal(first.status, 200);
    const id = first.body.lastGuestId;
    assert.equal(first.body.guests[0].summary.turns, 0);
    assert.equal(first.body.guests.length, 1);
    assert.match(first.headers.get('set-cookie'), /HttpOnly/);
    assert.match(first.headers.get('set-cookie'), /SameSite=Strict/);
    const chat = (await createChat(client, id)).body;
    assert.equal(
      (await ask(client, id, chat.id, 'Working hours?')).body.code,
      'WORKSPACE_KNOWLEDGE_EMPTY',
    );
    assert.equal((await upload(client)).status, 201);
    assert.equal((await upload(client)).body.duplicate, true);
    const requestId = randomUUID(),
      reply = await ask(client, id, chat.id, 'What are the working hours?', requestId);
    assert.equal(reply.status, 200);
    assert.match(reply.body.answer, /10 AM to 6 PM/);
    assert.equal(reply.body.passages[0].title, 'guide.txt');
    assert.equal('supportSummary' in reply.body, false);
    assert.equal(
      (await ask(client, id, chat.id, 'What are the working hours?', requestId)).status,
      200,
    );
    assert.equal((await ask(client, id, chat.id, 'different question', requestId)).status, 409);
    const messages = (await client('/guests/' + id + '/conversations/' + chat.id)).body.messages;
    const answer = messages.at(-1);
    await client('/guests/' + id + '/conversations/' + chat.id + '/feedback', {
      method: 'POST',
      body: { messageId: answer.id, rating: 'unclear' },
    });
    await client('/guests/' + id + '/conversations/' + chat.id + '/human-help', {
      method: 'POST',
      body: { messageId: answer.id },
    });
    const second = (await client('/guests', { method: 'POST' })).body;
    const snapshot = (await client()).body,
      original = snapshot.guests.find((g) => g.id === id),
      newGuest = snapshot.guests.find((g) => g.id === second.id);
    assert.equal(original.summary.turns, 1);
    assert.equal(original.summary.feedback.unclear, 1);
    assert.equal(original.summary.humanHelpRequests, 1);
    assert.equal(newGuest.summary.turns, 0);
    assert.equal(newGuest.summary.feedback.unclear, 0);
    assert.match(original.summary.overview.followUp, /private check-in/);
    assert.equal(JSON.stringify(snapshot).includes('What are the working hours?'), false);
    assert.equal(snapshot.documents[0].text, undefined);
    assert.equal(onboardingSnapshot(snapshot.guests).answers, 1);
    assert.equal(checkInStatus(original.summary), 'Human support requested');
    const secondChat = (await createChat(client, second.id)).body;
    assert.equal((await client('/guests/' + second.id + '/conversations/' + chat.id)).status, 404);
    assert.equal(
      (await client('/guests/' + id + '/conversations/' + secondChat.id, { method: 'DELETE' }))
        .status,
      404,
    );
    await client('/documents/' + snapshot.documents[0].id, { method: 'DELETE' });
    assert.equal(
      (await ask(client, id, chat.id, 'Working hours?')).body.code,
      'WORKSPACE_KNOWLEDGE_EMPTY',
    );
  } finally {
    await s.close();
  }
});

test('browser workspaces cannot read or mutate another browser’s files, guests, chats or reports', async () => {
  const s = await server(),
    a = s.client(),
    b = s.client();
  try {
    const wa = (await a()).body,
      wb = (await b()).body;
    await upload(a, 'private-guide.txt');
    const document = (await a()).body.documents[0],
      guest = wa.lastGuestId,
      chat = (await createChat(a, guest)).body;
    assert.equal((await b()).body.documents.length, 0);
    assert.notEqual(guest, wb.lastGuestId);
    for (const [path, options] of [
      ['/documents/' + document.id, { method: 'DELETE' }],
      ['/guests/' + guest + '/config', {}],
      ['/guests/' + guest + '/conversations/' + chat.id, {}],
    ])
      assert.equal((await b(path, options)).status, 404);
    const cross = await a('/guests', {
      method: 'POST',
      headers: { Origin: 'https://other.example' },
    });
    assert.equal(cross.status, 403);
    assert.equal(
      (
        await a('/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': '%bad' },
          body: Buffer.from(guidance),
        })
      ).status,
      400,
    );
    const expired = b;
    assert.equal(
      (await expired('/engine', { method: 'POST', body: { engine: 'gemini' } })).status,
      404,
    );
    assert.equal((await a()).body.guests[0].summary.turns, 0);
    assert.equal(
      (
        await a('/guests/' + guest + '/follow-up', {
          method: 'POST',
          body: { status: 'planned', note: 'manual report' },
        })
      ).status,
      404,
    );
  } finally {
    await s.close();
  }
});

test('Gemini retrieves only current workspace files, preserves memory and exposes billing failures', async () => {
  const seen = [];
  const models = {
    plan: { invoke: async () => ({ kind: 'company', query: 'working hours', clarification: '' }) },
    answer: {
      invoke: async (messages) => {
        const text = messages.map((m) => m.content).join('\n');
        seen.push(text);
        if (text.includes('billing test'))
          throw Object.assign(new Error('private provider content'), { status: 402 });
        return {
          answer: text.includes('11 AM')
            ? 'Office hours start at 11 AM.'
            : 'Office hours are 10 AM to 6 PM Monday to Friday.',
          citations: [1],
        };
      },
    },
  };
  const s = await server(models),
    a = s.client(),
    b = s.client();
  try {
    const id = (await a()).body.lastGuestId;
    await b();
    await upload(b, 'other.txt', 'Working Hours\nOTHER WORKSPACE PRIVATE GUIDE. Hours are 7 AM.');
    const original = (await upload(a)).body,
      chat = (await createChat(a, id)).body;
    const answer = await ask(a, id, chat.id, 'Working hours?');
    assert.equal(answer.status, 200);
    assert.match(answer.body.answer, /10 AM/);
    assert.equal(answer.body.mode, 'gemini-memory');
    assert.equal(seen[0].includes('OTHER WORKSPACE'), false);
    await a('/documents/' + original.id, { method: 'DELETE' });
    await upload(a, 'new.txt', 'Working Hours\nOffice hours start at 11 AM Monday to Friday.');
    const updated = await ask(a, id, chat.id, 'And the working hours now?');
    assert.match(updated.body.answer, /11 AM/);
    assert.equal(updated.body.passages[0].title, 'new.txt');
    const failed = await ask(a, id, chat.id, 'billing test');
    assert.equal(failed.status, 402);
    assert.equal(failed.body.code, 'GEMINI_CREDIT_REQUIRED');
    assert.equal(JSON.stringify(failed.body).includes('private provider'), false);
    assert.equal((await a()).body.guests[0].summary.turns, 2);
    assert.equal((await a('/guests/' + id + '/conversations/' + chat.id)).body.messages.length, 4);
  } finally {
    await s.close();
  }
});

test('employee chat recognises Vertex AI configuration without requiring an API key', async () => {
  const s = await server(null, { env: { GOOGLE_CLOUD_PROJECT: 'onboardai-test' } });
  const client = s.client();
  try {
    const id = (await client()).body.lastGuestId;
    const config = await client('/guests/' + id + '/config');
    assert.equal(config.status, 200);
    assert.equal(config.body.aiMode, 'gemini-memory');
    assert.equal(config.body.answerFormatsAvailable, true);
  } finally {
    await s.close();
  }
});

// A synthetic Vertex AI Search chunk-mode response for one company document.
const searchResponse = (text, file = 'Company%20handbook.pdf') => ({
  results: [
    {
      id: 'handbook',
      chunk: {
        name: 'projects/p/locations/global/collections/c/dataStores/d/branches/0/documents/handbook/chunks/c1',
        id: 'c1',
        content: text,
        documentMetadata: { uri: 'gs://synthetic-bucket/' + file, title: 'handbook' },
        pageSpan: { pageStart: 2, pageEnd: 2 },
      },
    },
  ],
});
const searchEnv = { GOOGLE_CLOUD_PROJECT: 'test-project', VERTEX_SEARCH_ENGINE_ID: 'test-engine' };

test('company document search and website uploads both feed employee answers without a user engine selector', async () => {
  let company = 'Working Hours\nOffice hours start at 9 AM Monday to Friday.',
    fail = false;
  const requests = [];
  const s = await server(null, {
    env: { AI_MODE: 'document-search', ...searchEnv },
    fetchImpl: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      if (fail)
        return new Response(JSON.stringify({ error: { message: 'private provider error' } }), {
          status: 403,
        });
      return Response.json(searchResponse(company));
    },
  });
  const client = s.client();
  try {
    const initial = (await client()).body,
      id = initial.lastGuestId;
    assert.deepEqual(initial.companyKnowledge.drive, { state: 'configured', documents: [] });
    assert.equal(requests.length, 0, 'the HR library status does not run a billed search');
    const chat = (await createChat(client, id)).body;
    // Company search is configured, so no upload is needed before the first question.
    const first = await ask(client, id, chat.id, 'What are the working hours?');
    assert.equal(first.status, 200);
    assert.match(first.body.answer, /9 AM/);
    assert.equal(first.body.passages[0].title, 'Company handbook.pdf');
    assert.match(requests[0].url, /test-engine\/servingConfigs\/default_search:search$/);
    assert.equal(requests[0].body.query, 'What are the working hours?');
    await upload(
      client,
      'extra-guide.txt',
      'Dress Code\nPlain T-shirts are permitted on Fridays only.',
    );
    company = 'Dress Code\nSmart casual clothing is expected in the office.';
    const dress = await ask(client, id, chat.id, 'Can I wear a T-shirt?');
    assert.deepEqual(
      dress.body.passages.map((p) => p.title),
      ['Company handbook.pdf', 'extra-guide.txt'],
    );
    assert.match(dress.body.answer, /Smart casual/);
    assert.match(dress.body.answer, /Fridays only/);
    company = 'Working Hours\nOffice hours start at 11 AM Monday to Friday.';
    assert.match(
      (await ask(client, id, chat.id, 'What are the working hours?')).body.answer,
      /11 AM/,
    );
    fail = true;
    const error = await ask(client, id, chat.id, 'What are the working hours?');
    assert.equal(error.status, 503);
    assert.equal(error.body.code, 'SEARCH_ACCESS_DENIED');
    assert.equal(JSON.stringify(error.body).includes('private provider'), false);
    assert.equal((await client()).body.guests[0].summary.turns, 3);
    assert.equal(
      (await client('/engine', { method: 'POST', body: { engine: 'gemini' } })).status,
      404,
    );
    const config = (await client('/guests/' + id + '/config')).body;
    assert.equal(config.employeeName, 'Employee 01');
    assert.equal(config.knowledgeMode, 'company-documents');
  } finally {
    await s.close();
  }
});

test('Gemini receives company search passages and this workspace’s uploads, never the sample guide', async () => {
  const seen = [];
  const models = {
    plan: { invoke: async () => ({ kind: 'company', query: 'working hours', clarification: '' }) },
    answer: {
      invoke: async (messages) => {
        seen.push(messages.map((m) => m.content).join('\n'));
        return { answer: 'Office hours start at 9 AM.', citations: [1, 2] };
      },
    },
  };
  const s = await server(models, {
    env: searchEnv,
    fetchImpl: async () =>
      Response.json(searchResponse('Working Hours\nOffice hours start at 9 AM Monday to Friday.')),
  });
  const client = s.client();
  try {
    const id = (await client()).body.lastGuestId;
    await upload(client, 'team-hours.txt', 'Working Hours\nThe design team starts at 10 AM.');
    const chat = (await createChat(client, id)).body;
    const reply = await ask(client, id, chat.id, 'What are the working hours?');
    assert.equal(reply.status, 200);
    assert.equal(reply.body.mode, 'gemini-memory');
    assert.deepEqual(
      reply.body.passages.map((p) => p.title),
      ['Company handbook.pdf', 'team-hours.txt'],
    );
    assert.match(seen[0], /Office hours start at 9 AM Monday to Friday/);
    assert.match(seen[0], /The design team starts at 10 AM/);
    assert.equal(seen[0].includes('Unapproved sample guidance'), false);
  } finally {
    await s.close();
  }
});

test('an incomplete company search setting is shown to HR without a search request', async () => {
  const s = await server(null, { env: { VERTEX_SEARCH_ENGINE_ID: 'test-engine' } });
  const client = s.client();
  try {
    const { drive } = (await client()).body.companyKnowledge;
    assert.equal(drive.state, 'unavailable');
    assert.equal(drive.code, 'SEARCH_NOT_CONFIGURED');
    assert.deepEqual(drive.documents, []);
  } finally {
    await s.close();
  }
});

test('the HR summary follows employee question requests automatically with no HR-authored input', async () => {
  const models = {
    plan: { invoke: async () => ({ kind: 'company', query: 'working hours', clarification: '' }) },
    answer: {
      invoke: async () => ({
        answer: 'Office hours are 10 AM to 6 PM Monday to Friday.',
        citations: [1],
      }),
    },
  };
  const s = await server(models),
    client = s.client();
  try {
    const id = (await client()).body.lastGuestId;
    await upload(client);
    const chat = (await createChat(client, id)).body;
    await ask(client, id, chat.id, 'I need smaller steps about the working hours.');
    await ask(client, id, chat.id, 'Give me a worked example.');
    const summary = (await client()).body.guests[0].summary;
    assert.equal(summary.requests.steps, 1);
    assert.equal(summary.requests.example, 1);
    assert.equal(summary.turns, 2);
    assert.match(summary.overview.interaction, /Across 2 answered questions in 1 conversation/);
    assert.match(summary.overview.interaction, /smaller steps/);
    assert.match(summary.overview.interaction, /worked examples/);
    assert.ok(summary.overview.recommendations.some((item) => item.includes('manageable action')));
    assert.ok(summary.overview.recommendations.some((item) => item.includes('practical example')));
    assert.equal(
      (
        await client('/guests/' + id + '/follow-up', {
          method: 'POST',
          body: { note: 'manual report' },
        })
      ).status,
      404,
    );
  } finally {
    await s.close();
  }
});

test('employee documents and automatic reports survive restart and expire together after inactivity', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'onboardai-workspace-')),
    path = join(folder, 'workspace.sqlite');
  let store = createGuestWorkspaceStore({ path });
  try {
    await store.ensure('browser-a');
    const guest = store.newGuest('browser-a');
    store.addDocument('browser-a', { name: 'guide.txt', text: guidance, bytes: guidance.length });
    const chat = await store.memory.create(guest.chat_owner);
    const turn = await store.memory.acquire(guest.chat_owner, chat.id);
    await turn.save(
      [
        { id: 'q', requestId: 'test-turn', role: 'user', text: 'Working hours?' },
        {
          id: 'a',
          requestId: 'test-turn',
          role: 'assistant',
          text: '10 AM.',
          result: { answer: '10 AM.' },
        },
      ],
      {},
    );
    await turn.release();
    await store.close();
    store = createGuestWorkspaceStore({ path });
    assert.equal((await store.snapshot('browser-a')).documents.length, 1);
    assert.equal(
      (await store.snapshot('browser-a')).guests.find((g) => g.id === guest.id).summary.turns,
      1,
    );
    store.memory.checkpointer.db
      .prepare('UPDATE guest_workspaces SET updated=? WHERE owner=?')
      .run(Date.now() - guestWorkspaceLifetime - 1000, 'browser-a');
    await store.ensure('browser-b');
    assert.throws(
      () => store.guest('browser-a', guest.id),
      (e) => e.status === 404,
    );
    assert.equal(store.documents('browser-a').length, 0);
    await assert.rejects(store.memory.read(guest.chat_owner, chat.id), (e) => e.status === 404);
  } finally {
    await store.close();
    assert.equal(dirname(folder), tmpdir());
    rmSync(folder, { recursive: true, force: true });
  }
});

test('employee removal clears only owned records, rejects busy chats and permits an empty workspace', async () => {
  const store = createGuestWorkspaceStore({ path: ':memory:' });
  try {
    const first = (await store.snapshot('one')).guests[0];
    const second = store.newGuest('one');
    const other = (await store.snapshot('two')).guests[0];
    store.addDocument('one', { name: 'guide.txt', text: guidance, bytes: guidance.length });
    const chat = await store.memory.create('guest:' + first.id);
    const another = await store.memory.create('guest:' + first.id);
    const { release } = await store.memory.acquire('guest:' + first.id, another.id);
    await assert.rejects(store.removeGuest('two', first.id), { status: 404 });
    await assert.rejects(store.removeGuest('one', first.id), { status: 409, code: 'CHAT_BUSY' });
    assert.equal((await store.memory.list('guest:' + first.id)).length, 2);
    assert.equal(store.guest('one', first.id).id, first.id);
    await release();
    await store.removeGuest('one', first.id);
    assert.equal((await store.memory.list('guest:' + first.id)).length, 0);
    await assert.rejects(store.memory.read('guest:' + first.id, chat.id), { status: 404 });
    assert.throws(() => store.guest('one', first.id), { status: 404 });
    assert.equal((await store.snapshot('one')).documents.length, 1);
    assert.equal((await store.snapshot('two')).guests[0].id, other.id);
    const replacement = store.newGuest('one');
    assert.notEqual(replacement.name, second.name);
    await store.removeGuest('one', second.id);
    assert.equal((await store.snapshot('one')).lastGuestId, replacement.id);
    await store.removeGuest('one', replacement.id);
    assert.equal((await store.snapshot('one')).guests.length, 0);
    assert.equal((await store.snapshot('one')).lastGuestId, null);
  } finally {
    await store.close();
  }
});
