import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeApi, hrKnowledgeBase } from '../../src/access/company-knowledge-api.mjs';

function recorder() {
  const calls = [];
  return { calls, request: async (url, options) => (calls.push([url, options]), { ok: true }) };
}

test('base paths', () => {
  assert.equal(hrKnowledgeBase, '/api/hr/company-knowledge');
});

test('the HR adapter targets /api/hr/company-knowledge', async () => {
  const { calls, request } = recorder();
  const api = createKnowledgeApi(hrKnowledgeBase, request);
  const file = { name: 'IT guide.pdf', size: 10 };
  await api.snapshot();
  await api.upload(file, { category: 'it', name: '' });
  await api.remove('doc 1');
  assert.deepEqual(
    calls.map(([url, o]) => [o.method, url]),
    [
      ['GET', '/api/hr/company-knowledge'],
      ['POST', '/api/hr/company-knowledge/documents?category=it'],
      ['DELETE', '/api/hr/company-knowledge/documents/doc%201'],
    ],
  );
  assert.equal(calls[1][1].rawBody, file);
  assert.equal(calls[1][1].headers['X-File-Name'], 'IT%20guide.pdf');
});
