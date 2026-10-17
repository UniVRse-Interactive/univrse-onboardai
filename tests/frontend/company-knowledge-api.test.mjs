import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeApi, hrKnowledgeBase } from '../../src/access/company-knowledge-api.mjs';

function recorder(reply = { ok: true }) {
  const calls = [];
  return { calls, request: async (url, options) => (calls.push([url, options]), reply) };
}

test('base paths', () => {
  assert.equal(hrKnowledgeBase, '/api/hr/company-knowledge');
});

test('the HR adapter targets /api/hr/company-knowledge', async () => {
  const { calls, request } = recorder();
  const api = createKnowledgeApi(hrKnowledgeBase, request);
  const file = { name: 'IT guide.pdf', size: 10 };
  await api.snapshot();
  await api.upload(file, { category: 'role-tools', name: '' });
  await api.upload(file, { category: 'additional', name: 'Safety' });
  await api.moveDocument('doc 1', 'policies');
  await api.remove('doc 1');
  assert.deepEqual(
    calls.map(([url, o]) => [o.method, url]),
    [
      ['GET', '/api/hr/company-knowledge'],
      ['POST', '/api/hr/company-knowledge/documents?category=role-tools'],
      ['POST', '/api/hr/company-knowledge/documents?category=additional&name=Safety'],
      ['PATCH', '/api/hr/company-knowledge/documents/doc%201'],
      ['DELETE', '/api/hr/company-knowledge/documents/doc%201'],
    ],
  );
  assert.equal(calls[1][1].rawBody, file);
  assert.equal(calls[1][1].headers['X-File-Name'], 'IT%20guide.pdf');
  assert.deepEqual(calls[3][1].body, { category: 'policies' });
  assert.equal(calls[3][1].rawBody, undefined);
});

test('upload passes the abort signal and returns the server reply as is', async () => {
  const { calls, request } = recorder({ id: 'd1', duplicate: false });
  const api = createKnowledgeApi(hrKnowledgeBase + '/', request);
  const signal = new AbortController().signal;
  assert.deepEqual(await api.upload({ name: 'a.md', size: 1 }, { category: 'alignment' }, signal), {
    id: 'd1',
    duplicate: false,
  });
  assert.equal(calls[0][1].signal, signal);
  assert.equal(calls[0][0], '/api/hr/company-knowledge/documents?category=alignment');
});
