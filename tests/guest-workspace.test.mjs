import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createApp } from '../server/api-routes.mjs';
import {
  createGuestWorkspaceStore,
  guestWorkspaceLifetime,
} from '../server/guest-workspace-store.mjs';
import { onboardingSnapshot, checkInStatus } from '../src/access/hr-report-insights.mjs';
import { DriveKnowledgeError } from '../server/google-drive-documents.mjs';

const guidance =
  'Working Hours\nOffice hours are 10 AM to 6 PM Monday to Friday.\nDress Code\nPlain T-shirts are permitted on Fridays only.';
const linkedFixtures = new Map();
async function server(models = null, options = {}) {
  const store = createGuestWorkspaceStore({ path: ':memory:', geminiAvailable: !!models });
  const app = createApp({
    env: options.env || {},
    guestStore: store,
    guestModels: models,
    moveGoogleDocument: options.moveGoogleDocument,
    loadGoogleDocument:
      options.loadGoogleDocument ||
      (async (id) => {
        if (!linkedFixtures.has(id)) throw new Error('Unknown synthetic Google Doc');
        return linkedFixtures.get(id);
      }),
    loadDriveKnowledge:
      options.loadDrive ||
      (() => {
        throw new Error('Unconfigured Drive must not be read');
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
      app.locals.closeChat();
    },
  };
}
const upload = (client, name = 'guide.txt', text = guidance) => {
  const id =
    'fixture-' +
    createHash('sha256')
      .update(name + text)
      .digest('hex');
  linkedFixtures.set(id, { text });
  return client('/documents', {
    method: 'POST',
    body: {
      category: 'additional',
      name,
      url: 'https://docs.google.com/document/d/' + id + '/edit',
    },
  });
};
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
      415,
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

test('HR onboarding updates are browser-scoped, persisted and reject stale saves', async () => {
  const s = await server(),
    a = s.client(),
    b = s.client();
  try {
    const id = (await a()).body.lastGuestId;
    await b();
    const path = '/guests/' + id + '/onboarding';
    const details = {
      startDate: '2026-10-16',
      department: 'People',
      completed: ['arrival'],
      version: 0,
    };
    assert.equal((await b(path, { method: 'PATCH', body: details })).status, 404);
    assert.equal(
      (
        await a(path, {
          method: 'PATCH',
          body: details,
          headers: { Origin: 'https://other.example' },
        })
      ).status,
      403,
    );
    assert.equal((await a(path, { method: 'PATCH', body: details })).status, 200);
    assert.deepEqual((await a()).body.guests[0].onboarding, { ...details, version: 1 });
    assert.equal((await a(path, { method: 'PATCH', body: details })).status, 409);
    assert.equal((await a()).body.guests[0].summary.turns, 0);
    assert.equal(
      (await a(path, { method: 'PATCH', body: { ...details, version: 1, completed: ['unknown'] } }))
        .status,
      400,
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

test('Drive guidance and website uploads both feed employee answers without a user engine selector', async () => {
  let drive = [
      {
        title: 'Connected Drive handbook',
        text: 'Working Hours\nOffice hours start at 9 AM Monday to Friday.',
      },
    ],
    fail = false,
    calls = 0;
  const s = await server(null, {
    env: { AI_MODE: 'document-search', GOOGLE_DRIVE_FOLDER_ID: 'company-folder' },
    loadDrive: async () => {
      calls++;
      if (fail)
        throw Object.assign(new Error('private provider error'), { response: { status: 403 } });
      return drive;
    },
  });
  const client = s.client();
  try {
    const initial = (await client()).body,
      id = initial.lastGuestId;
    assert.equal(initial.companyKnowledge.drive.state, 'connected');
    assert.equal(initial.companyKnowledge.drive.documents[0].title, 'Connected Drive handbook');
    assert.equal(initial.companyKnowledge.drive.documents[0].text, undefined);
    const chat = (await createChat(client, id)).body;
    const first = await ask(client, id, chat.id, 'What are the working hours?');
    assert.equal(first.status, 200);
    assert.match(first.body.answer, /9 AM/);
    assert.equal(first.body.passages[0].title, 'Connected Drive handbook');
    await upload(
      client,
      'extra-guide.txt',
      'Dress Code\nPlain T-shirts are permitted on Fridays only.',
    );
    assert.match(
      (await ask(client, id, chat.id, 'Can I wear a T-shirt?')).body.answer,
      /Fridays only/,
    );
    drive = [
      {
        title: 'Connected Drive handbook',
        text: 'Working Hours\nOffice hours start at 11 AM Monday to Friday.',
      },
    ];
    assert.match(
      (await ask(client, id, chat.id, 'What are the working hours?')).body.answer,
      /11 AM/,
    );
    fail = true;
    const error = await ask(client, id, chat.id, 'What are the working hours?');
    assert.equal(error.status, 503);
    assert.equal(error.body.code, 'DRIVE_ACCESS_DENIED');
    assert.equal(JSON.stringify(error.body).includes('private provider'), false);
    assert.equal((await client()).body.guests[0].summary.turns, 3);
    assert.ok(calls >= 5);
    assert.equal(
      (await client('/engine', { method: 'POST', body: { engine: 'gemini' } })).status,
      404,
    );
    assert.equal((await client('/guests/' + id + '/config')).body.employeeName, 'Employee 01');
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

test('source-search explanation controls preserve feedback and report each explicit request once', async () => {
  const s = await server(),
    client = s.client();
  try {
    const id = (await client()).body.lastGuestId;
    await upload(
      client,
      'support-guide.txt',
      'Working Hours\nOffice hours are 10 AM to 6 PM Monday to Friday. For example, a workday starts at 10 AM. Check with HR before changing this schedule.',
    );
    const config = (await client('/guests/' + id + '/config')).body;
    assert.equal(config.adaptiveLearning, true);
    assert.equal(config.answerFormatsAvailable, true);
    const chat = (await createChat(client, id)).body;
    const first = await ask(client, id, chat.id, 'What are the working hours?');
    const firstMessage = (
      await client('/guests/' + id + '/conversations/' + chat.id)
    ).body.messages.at(-1);
    assert.equal(first.status, 200);
    await client('/guests/' + id + '/conversations/' + chat.id + '/feedback', {
      method: 'POST',
      body: { messageId: firstMessage.id, rating: 'helpful' },
    });
    await client('/guests/' + id + '/conversations/' + chat.id + '/human-help', {
      method: 'POST',
      body: { messageId: firstMessage.id },
    });
    const setting = (format, identity = id) =>
      client('/guests/' + identity + '/conversations/' + chat.id + '/learning', {
        method: 'POST',
        body: { preference: format },
      });
    await setting('steps');
    assert.equal(
      (await client()).body.guests.find((guest) => guest.id === id).summary.turns,
      1,
      'a preference change is not an answered question',
    );
    const requestId = randomUUID();
    const steps = await ask(
      client,
      id,
      chat.id,
      'Please explain this step by step for this question: What are the working hours?',
      requestId,
    );
    assert.equal(steps.body.learning.format, 'steps');
    assert.equal(steps.body.searchQuery, 'What are the working hours?');
    assert.match(steps.body.answer, /10 AM to 6 PM/);
    await ask(
      client,
      id,
      chat.id,
      'Please explain this step by step for this question: What are the working hours?',
      requestId,
    );
    await setting('brief');
    assert.equal(
      (
        await ask(
          client,
          id,
          chat.id,
          'Please keep the answer brief for this question: What are the working hours?',
        )
      ).body.learning.format,
      'brief',
    );
    await setting('example');
    const example = await ask(
      client,
      id,
      chat.id,
      'Please give me a worked example for this question: What are the working hours?',
    );
    assert.equal(example.body.learning.format, 'example');
    assert.equal(example.body.exampleUnavailable, false);
    const summary = (await client()).body.guests.find((guest) => guest.id === id).summary;
    assert.equal(summary.turns, 4);
    assert.deepEqual(summary.requests, { steps: 1, example: 1, brief: 1 });
    assert.deepEqual(summary.formats, { standard: 1, steps: 1, example: 1, brief: 1 });
    assert.equal(summary.feedback.helpful, 1);
    assert.equal(summary.humanHelpRequests, 1);
    assert.match(summary.overview.interaction, /smaller steps/);
    const second = (await client('/guests', { method: 'POST' })).body;
    assert.equal((await setting('steps', second.id)).status, 404);
    assert.equal(
      (
        await client('/guests/' + id + '/conversations/' + chat.id + '/learning', {
          method: 'POST',
          body: { diagnosis: 'invalid' },
        })
      ).status,
      400,
    );
    assert.equal(
      (await client()).body.guests.find((guest) => guest.id === second.id).summary.turns,
      0,
    );
  } finally {
    await s.close();
  }
});

test('a missing sourced example records the request without pretending to deliver one', async () => {
  const s = await server(),
    client = s.client();
  try {
    const id = (await client()).body.lastGuestId;
    await upload(client);
    const chat = (await createChat(client, id)).body;
    const example = await ask(
      client,
      id,
      chat.id,
      'Give me a worked example for this question: What are the working hours?',
    );
    assert.equal(example.status, 200);
    assert.equal(example.body.exampleUnavailable, true);
    assert.equal(example.body.learning.format, 'standard');
    const summary = (await client()).body.guests[0].summary;
    assert.equal(summary.requests.example, 1);
    assert.equal(summary.formats.example, 0);
    assert.equal(summary.turns, 1);
  } finally {
    await s.close();
  }
});

test('employee documents and automatic reports survive restart and expire together after inactivity', () => {
  const folder = mkdtempSync(join(tmpdir(), 'onboardai-workspace-')),
    path = join(folder, 'workspace.sqlite');
  let store = createGuestWorkspaceStore({ path });
  try {
    store.ensure('browser-a');
    const guest = store.newGuest('browser-a');
    store.addDocument('browser-a', { name: 'guide.txt', text: guidance, bytes: guidance.length });
    const chat = store.memory.create(guest.chat_owner);
    store.memory.save(
      guest.chat_owner,
      chat.id,
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
    store.close();
    store = createGuestWorkspaceStore({ path });
    assert.equal(store.snapshot('browser-a').documents.length, 1);
    assert.equal(
      store.snapshot('browser-a').guests.find((g) => g.id === guest.id).summary.turns,
      1,
    );
    store.memory.checkpointer.db
      .prepare('UPDATE guest_workspaces SET updated=? WHERE owner=?')
      .run(Date.now() - guestWorkspaceLifetime - 1000, 'browser-a');
    store.ensure('browser-b');
    assert.throws(
      () => store.guest('browser-a', guest.id),
      (e) => e.status === 404,
    );
    assert.equal(store.documents('browser-a').length, 0);
    assert.throws(
      () => store.memory.read(guest.chat_owner, chat.id),
      (e) => e.status === 404,
    );
  } finally {
    store.close();
    assert.equal(dirname(folder), tmpdir());
    rmSync(folder, { recursive: true, force: true });
  }
});

test('employee removal clears only owned records, rejects busy chats and permits an empty workspace', () => {
  const store = createGuestWorkspaceStore({ path: ':memory:' });
  try {
    const first = store.snapshot('one').guests[0];
    const second = store.newGuest('one');
    const other = store.snapshot('two').guests[0];
    store.addDocument('one', { name: 'guide.txt', text: guidance, bytes: guidance.length });
    const chat = store.memory.create('guest:' + first.id);
    const another = store.memory.create('guest:' + first.id);
    const { release } = store.memory.acquire('guest:' + first.id, another.id);
    assert.throws(() => store.removeGuest('two', first.id), { status: 404 });
    assert.throws(() => store.removeGuest('one', first.id), { status: 409 });
    assert.equal(store.memory.list('guest:' + first.id).length, 2);
    release();
    store.removeGuest('one', first.id);
    assert.equal(store.memory.list('guest:' + first.id).length, 0);
    assert.throws(() => store.memory.read('guest:' + first.id, chat.id), { status: 404 });
    assert.throws(() => store.guest('one', first.id), { status: 404 });
    assert.equal(store.snapshot('one').documents.length, 1);
    assert.equal(store.snapshot('two').guests[0].id, other.id);
    const replacement = store.newGuest('one');
    assert.notEqual(replacement.name, second.name);
    store.removeGuest('one', second.id);
    assert.equal(store.snapshot('one').lastGuestId, replacement.id);
    store.removeGuest('one', replacement.id);
    assert.equal(store.snapshot('one').guests.length, 0);
    assert.equal(store.snapshot('one').lastGuestId, null);
  } finally {
    store.close();
  }
});

test('local HR moves a Doc before saving its connection, and the company folder serves other browsers', async () => {
  let failMove = true,
    reads = 0;
  const shared = [];
  const s = await server(null, {
    env: { GOOGLE_DRIVE_FOLDER_ID: 'company-folder-123', GOOGLE_DRIVE_DOCUMENT_MOVES: 'enabled' },
    loadDrive: async () => shared,
    loadGoogleDocument: async () => {
      reads++;
      return { text: guidance };
    },
    moveGoogleDocument: async (id, folderId, document) => {
      assert.equal(folderId, 'company-folder-123');
      if (failMove)
        throw Object.assign(
          new DriveKnowledgeError('DRIVE_MOVE_PERMISSION_REQUIRED', 'Editor access is required.'),
          { statusCode: 403 },
        );
      const alreadyInFolder = shared.some((file) => file.googleDocId === id);
      if (!alreadyInFolder)
        shared.push({
          googleDocId: id,
          title: document.name,
          category: document.category,
          text: document.text,
        });
      return { googleDocId: id, alreadyInFolder, moved: !alreadyInFolder };
    },
  });
  const a = s.client(),
    b = s.client();
  const add = () =>
    a('/documents', {
      method: 'POST',
      body: {
        category: 'handbook',
        url: 'https://docs.google.com/document/d/moving-guide-123/edit',
      },
    });
  try {
    assert.equal((await a()).body.driveMoves.enabled, true);
    assert.equal((await add()).status, 403);
    assert.equal(
      (await a()).body.documents.length,
      0,
      'failed moves do not create a misleading local connection',
    );
    failMove = false;
    const added = await add();
    assert.equal(added.status, 201);
    assert.equal(added.body.driveMove.moved, true);
    const first = (await a()).body;
    const other = (await b()).body;
    assert.equal(first.documents.length, 1);
    assert.equal(other.documents.length, 0, 'browser-owned records stay isolated');
    assert.equal(
      other.companyKnowledge.drive.documents[0].category,
      'handbook',
      'company folder guidance is shared',
    );
    for (const [client, snapshot] of [
      [a, first],
      [b, other],
    ]) {
      const chat = (await createChat(client, snapshot.lastGuestId)).body;
      const answer = await ask(
        client,
        snapshot.lastGuestId,
        chat.id,
        'What are the working hours?',
      );
      assert.equal(answer.status, 200);
      assert.match(answer.body.answer, /10 AM/);
    }
    assert.equal(
      reads,
      2,
      'a document in the company folder is not read a second time as a local link',
    );
    assert.equal((await add()).body.driveMove.alreadyInFolder, true);
    assert.equal(shared.length, 1, 'a retried request does not duplicate the company document');
  } finally {
    await s.close();
  }
});

test('the preview HR role cannot perform company Drive writes in production or through a forwarded request', async () => {
  for (const production of [true, false]) {
    let calls = 0;
    const s = await server(null, {
      env: {
        GOOGLE_DRIVE_FOLDER_ID: 'company-folder-123',
        GOOGLE_DRIVE_DOCUMENT_MOVES: 'enabled',
        ...(production ? { NODE_ENV: 'production' } : {}),
      },
      loadDrive: async () => [],
      loadGoogleDocument: async () => {
        calls++;
        return { text: guidance };
      },
      moveGoogleDocument: async () => {
        calls++;
        throw new Error('Must never write');
      },
    });
    try {
      const client = s.client();
      const response = await client('/documents', {
        method: 'POST',
        ...(production ? {} : { headers: { 'X-Forwarded-For': '203.0.113.1' } }),
        body: {
          category: 'company',
          url: 'https://docs.google.com/document/d/private-guide-123/edit',
        },
      });
      assert.equal(response.status, 403);
      assert.equal(response.body.code, 'DRIVE_MOVE_HR_ACCESS_REQUIRED');
      assert.equal(calls, 0);
    } finally {
      await s.close();
    }
  }
});

test('HR connects category-labelled Google Docs, reads current guidance and fails closed on revoked access', async () => {
  let text = 'Working Hours\nOffice hours are 10 AM to 6 PM Monday to Friday.';
  let revoked = false;
  let reads = 0;
  const s = await server(null, {
    loadGoogleDocument: async (id) => {
      reads++;
      if (id === 'disguised-pdf-123')
        throw new DriveKnowledgeError(
          'GOOGLE_DOC_TYPE_REQUIRED',
          'Only native Google Docs are accepted.',
        );
      if (revoked)
        throw Object.assign(new Error('private Google details'), { response: { status: 403 } });
      return { text };
    },
  });
  const a = s.client(),
    b = s.client();
  const connect = (client, id, category = 'handbook') =>
    client('/documents', {
      method: 'POST',
      body: {
        category,
        name: 'Old private filename.docx',
        url: 'https://docs.google.com/document/d/' + id + '/edit',
      },
    });
  try {
    const guest = (await a()).body.lastGuestId;
    await b();
    const created = await connect(a, 'employee-handbook-123');
    assert.equal(created.status, 201);
    const snapshot = (await a()).body;
    assert.equal(snapshot.documents[0].title, 'Employee Handbook');
    assert.equal(snapshot.documents[0].category, 'handbook');
    assert.equal(snapshot.documents[0].googleDocId, 'employee-handbook-123');
    assert.equal(JSON.stringify(snapshot).includes('Old private filename'), false);
    assert.equal('text' in snapshot.documents[0], false);
    assert.equal('fingerprint' in snapshot.documents[0], false);
    assert.equal((await b()).body.documents.length, 0);
    assert.equal((await b('/documents/' + created.body.id, { method: 'DELETE' })).status, 404);
    const chat = (await createChat(a, guest)).body;
    const initial = await ask(a, guest, chat.id, 'What are the working hours?');
    assert.match(initial.body.answer, /10 AM/);
    assert.equal(initial.body.passages[0].title, 'Employee Handbook');
    text = 'Working Hours\nOffice hours are 11 AM to 6 PM Monday to Friday.';
    assert.match(
      (await ask(a, guest, chat.id, 'What are the working hours?')).body.answer,
      /11 AM/,
    );
    revoked = true;
    const rejected = await ask(a, guest, chat.id, 'What are the working hours?');
    assert.equal(rejected.status, 503);
    assert.equal(rejected.body.code, 'DRIVE_ACCESS_DENIED');
    assert.equal(JSON.stringify(rejected.body).includes('private Google'), false);
    assert.equal((await a()).body.guests[0].summary.turns, 2);
    revoked = false;
    const replaced = await connect(a, 'new-employee-handbook-456');
    assert.equal(replaced.status, 200);
    assert.equal(replaced.body.replaced, true);
    assert.equal(replaced.body.id, created.body.id);
    assert.equal((await a()).body.documents.length, 1);
    assert.equal((await connect(a, 'disguised-pdf-123', 'company')).status, 422);
    const before = reads;
    assert.equal(
      (
        await a('/documents', {
          method: 'POST',
          body: { category: 'company', url: 'https://evil.example/document/d/company-123/edit' },
        })
      ).status,
      400,
    );
    assert.equal(reads, before, 'invalid links never reach Google');
    const file = await a('/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from('local file'),
    });
    assert.equal(file.status, 415);
    assert.equal(file.body.code, 'GOOGLE_DOC_ONLY');
  } finally {
    await s.close();
  }
});
