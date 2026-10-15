import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/api-routes.mjs';

async function fixture(run) {
  const models = {
    plan: { invoke: async () => ({ kind: 'company', query: 'badge', clarification: '' }) },
    answer: {
      invoke: async (messages) => {
        const passages = JSON.parse(messages[0].content.split('Reference passages: ')[1]);
        return {
          answer: passages.map((p) => p.text).join('\n'),
          citations: passages.map((p) => p.id),
        };
      },
    },
  };
  const app = createApp({
    env: {
      AI_MODE: 'gemini-chat',
      CHAT_DATABASE_PATH: ':memory:',
      GOOGLE_DRIVE_FOLDER_ID: 'test-folder',
    },
    models,
    loadDriveKnowledge: async () => [
      { title: 'Connected Drive guide', text: 'Badge: collect the access badge from reception.' },
    ],
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port;
  const browser = () => {
    let cookie = '';
    return async (path, method = 'GET', body, headers = {}) => {
      const r = await fetch(url + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Origin: url,
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      cookie = r.headers.get('set-cookie')?.split(';')[0] || cookie;
      return { status: r.status, data: r.status === 204 ? null : await r.json() };
    };
  };
  try {
    await run(browser);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    app.locals.closeChat();
  }
}

test('preview roles guard HR endpoints, isolate browser workspaces and start employee reports empty', async () =>
  fixture(async (browser) => {
    const a = browser(),
      b = browser();
    assert.equal((await a('/api/hr/workspace')).status, 403);
    await a('/api/access', 'POST', { role: 'hr' });
    const created = await a('/api/hr/employees', 'POST', {
      name: 'Synthetic employee',
      employeeId: 'TEST-1',
    });
    assert.equal(created.status, 201);
    const first = (await a('/api/hr/workspace')).data.employees[0];
    assert.equal(first.summary.turns, 0);
    await b('/api/access', 'POST', { role: 'hr' });
    assert.equal((await b('/api/hr/workspace')).data.employees.length, 0);
    assert.equal((await b('/api/hr/employees/' + created.data.id, 'DELETE')).status, 404);
    await a('/api/access', 'POST', { role: 'employee', action: 'select', employeeId: 'TEST-1' });
    assert.equal((await a('/api/hr/workspace')).status, 403);
    assert.equal((await a('/api/hr/documents', 'POST', { name: 'x.txt', text: 'x' })).status, 403);
    assert.equal(
      (await a('/api/access', 'POST', { role: 'hr' }, { Origin: 'https://untrusted.example' }))
        .status,
      403,
    );
  }));

test('uploaded guidance joins Drive retrieval; feedback and history stay with stable employee IDs after removal', async () =>
  fixture(async (browser) => {
    const a = browser();
    await a('/api/access', 'POST', { role: 'hr' });
    const doc = await a('/api/hr/documents', 'POST', {
      name: 'badge.md',
      text: 'Badge: keep the badge visible in shared areas.',
    });
    assert.equal(doc.status, 201);
    const first = (await a('/api/hr/employees', 'POST', { name: 'First', employeeId: 'E1' })).data;
    const second = (await a('/api/hr/employees', 'POST', { name: 'Second', employeeId: 'E2' }))
      .data;
    await a('/api/access', 'POST', { role: 'employee', action: 'select', employeeId: 'E2' });
    const chat = (await a('/api/conversations', 'POST')).data;
    const requestId = randomUUID();
    const answer = await a('/api/chat', 'POST', {
      question: 'Please explain the badge step by step',
      taskId: 'company-resources',
      conversationId: chat.id,
      requestId,
    });
    assert.equal(answer.status, 200);
    assert.match(answer.data.source, /Connected Drive guide/);
    assert.match(answer.data.source, /Uploaded: badge.md/);
    await a('/api/conversations/' + chat.id + '/feedback', 'POST', {
      messageId: requestId + '-a',
      rating: 'unclear',
    });
    await a('/api/access', 'POST', { role: 'employee', action: 'select', employeeId: 'E1' });
    assert.equal((await a('/api/conversations/' + chat.id)).status, 404);
    assert.equal(
      (await a('/api/conversations', 'GET', undefined, { 'X-OnboardAi-Employee': second.id }))
        .status,
      409,
    );
    await a('/api/access', 'POST', { role: 'hr' });
    let report = (await a('/api/hr/workspace')).data;
    assert.equal(report.employees.find((e) => e.id === first.id).summary.turns, 0);
    const s = report.employees.find((e) => e.id === second.id).summary;
    assert.equal(s.turns, 1);
    assert.equal(s.requests.steps, 1);
    assert.equal(s.feedback.unclear, 1);
    assert.ok(!JSON.stringify(report).includes('keep the badge visible'));
    assert.ok(!JSON.stringify(report).includes('Please explain'));
    assert.equal((await a('/api/hr/employees/' + first.id, 'DELETE')).status, 204);
    report = (await a('/api/hr/workspace')).data;
    assert.equal(report.employees[0].id, second.id);
    assert.equal(report.employees[0].summary.turns, 1);
    const replacement = (
      await a('/api/hr/employees', 'POST', { name: 'Replacement', employeeId: 'E1' })
    ).data;
    assert.notEqual(replacement.id, first.id);
    assert.equal(
      (await a('/api/hr/workspace')).data.employees.find((e) => e.id === replacement.id).summary
        .turns,
      0,
    );
    await a('/api/hr/documents/' + doc.data.id, 'DELETE');
    await a('/api/access', 'POST', { role: 'employee', action: 'select', employeeId: 'E2' });
    const next = await a('/api/chat', 'POST', {
      question: 'Explain the badge',
      taskId: 'company-resources',
      conversationId: chat.id,
      requestId: randomUUID(),
    });
    assert.equal(next.status, 200);
    assert.ok(!next.data.source.includes('Uploaded:'));
  }));

test('upload validation rejects unsupported, binary, empty, oversized and cross-workspace documents', async () =>
  fixture(async (browser) => {
    const a = browser(),
      b = browser();
    await a('/api/access', 'POST', { role: 'hr' });
    await b('/api/access', 'POST', { role: 'hr' });
    for (const body of [
      { name: 'x.pdf', text: 'hello' },
      { name: '../x.txt', text: 'hello' },
      { name: 'x.txt', text: '' },
      { name: 'x.txt', text: 'bad\u0000' },
      { name: 'x.md', text: 'a'.repeat(100001) },
    ])
      assert.equal((await a('/api/hr/documents', 'POST', body)).status, 400);
    assert.equal(
      (await a('/api/hr/documents', 'POST', { name: 'x.md', text: 'a'.repeat(170000) })).status,
      413,
    );
    const doc = (
      await a('/api/hr/documents', 'POST', { name: 'guide.txt', text: 'Safe guidance.' })
    ).data;
    assert.equal((await b('/api/hr/documents/' + doc.id, 'DELETE')).status, 404);
    assert.equal((await b('/api/hr/workspace')).data.documents.length, 0);
    assert.equal((await a('/api/hr/documents/' + doc.id, 'DELETE')).status, 204);
  }));
