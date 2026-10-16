import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createKnowledgeApi,
  guestKnowledgeBase,
  hrKnowledgeBase,
} from '../../src/access/company-knowledge-api.mjs';

function recorder() {
  const calls = [];
  return { calls, request: async (url, options) => (calls.push([url, options]), { ok: true }) };
}

test('base paths', () => {
  assert.equal(hrKnowledgeBase, '/api/hr/company-knowledge');
  assert.equal(guestKnowledgeBase, '/api/guest-workspace');
});

test('the HR adapter targets /api/hr/company-knowledge', async () => {
  const { calls, request } = recorder();
  const api = createKnowledgeApi(hrKnowledgeBase, request);
  await api.snapshot();
  await api.connect({ category: 'it', url: 'https://docs.google.com/document/d/x', name: '' });
  await api.disconnect('doc 1');
  assert.deepEqual(
    calls.map(([url, o]) => [o.method, url]),
    [
      ['GET', '/api/hr/company-knowledge'],
      ['POST', '/api/hr/company-knowledge/documents'],
      ['DELETE', '/api/hr/company-knowledge/documents/doc%201'],
    ],
  );
  assert.deepEqual(calls[1][1].body, {
    category: 'it',
    url: 'https://docs.google.com/document/d/x',
    name: '',
  });
});

test('the same adapter serves the guest workspace and ignores a trailing slash', async () => {
  const { calls, request } = recorder();
  const api = createKnowledgeApi(guestKnowledgeBase + '/', request);
  assert.equal(api.base, '/api/guest-workspace');
  await api.connect({ category: 'company', url: 'u' });
  assert.equal(calls[0][0], '/api/guest-workspace/documents');
});
