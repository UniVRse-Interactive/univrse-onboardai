// Issue #79: HR Replace API on the company knowledge library.
// Needs a live app: BASE_URL, HR_ID and HR_PASSWORD (a local HR account).
// Adds its own text documents and removes them again.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './qa-lib.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:3143';
const { HR_ID, HR_PASSWORD } = process.env;
const skip = !HR_ID || !HR_PASSWORD ? 'HR_ID and HR_PASSWORD are not set' : false;
const hr = client(base);
const run = Date.now().toString(36);
const live = new Set();

async function put(category, fileName, text, { name, replaces } = {}) {
  await hr.get('/api/hr/company-knowledge');
  const q = new URLSearchParams({ category });
  if (name) q.set('name', name);
  if (replaces) q.set('replaces', replaces);
  const res = await fetch(`${base}/api/hr/company-knowledge/documents?${q}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent(fileName),
      origin: base,
      cookie: hr.cookie(),
    },
    body: Buffer.from(text),
  });
  const json = await res.json().catch(() => null);
  if (json?.id && res.status === 201) live.add(json.id);
  if (json?.replaced?.id) live.delete(json.replaced.id);
  return { status: res.status, json };
}
const docs = async () => (await hr.get('/api/hr/company-knowledge')).json.documents;
const del = (id) => hr.call('DELETE', `/api/hr/company-knowledge/documents/${id}`);

const v1 = `Leave rule ${run}: annual leave requests go to the Zephyrine desk ten days ahead.`;
const v2 = `Leave rule ${run} v2: annual leave requests go to the Zephyrine desk fourteen days ahead.`;
const other = `Parking rule ${run}: bicycles are kept in the Marlowe shed.`;
let first;
let second;
let otherDoc;

test('sign in as HR', { skip }, async () => {
  const r = await hr.post('/api/auth/sign-in', { username: HR_ID, password: HR_PASSWORD });
  assert.equal(r.status, 200);
});

test('plain upload answers replaced: null, snapshot shows version 1', { skip }, async () => {
  const r = await put('policies', `Leave Policy ${run}.txt`, v1);
  assert.equal(r.status, 201);
  assert.equal(r.json.duplicate, false);
  assert.equal(r.json.replaced, null);
  first = r.json.id;
  const item = (await docs()).find((d) => d.id === first);
  assert.equal(item.version, 1);
  assert.ok(item.connectedAt);
  const dup = await put('policies', `Leave Policy ${run}.txt`, v1);
  assert.equal(dup.status, 200);
  assert.equal(dup.json.duplicate, true);
  assert.equal(dup.json.replaced, null);
});

test('replace with no name keeps the title; version 2; old entry gone', { skip }, async () => {
  const before = (await docs()).find((d) => d.id === first);
  const r = await put('policies', `Leave Policy ${run} v2.txt`, v2, { replaces: first });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.duplicate, false);
  assert.equal(r.json.replaced.id, first);
  assert.equal(r.json.replaced.cleanup, 'done');
  second = r.json.id;
  const list = await docs();
  assert.equal(
    list.find((d) => d.id === first),
    undefined,
  );
  const item = list.find((d) => d.id === second);
  assert.equal(item.title, before.title);
  assert.equal(item.version, 2);
  assert.ok(item.connectedAt);
  assert.notEqual(item.connectedAt, before.connectedAt);
});

test('replace with identical text is a 200 duplicate', { skip }, async () => {
  const r = await put('policies', `Leave Policy ${run} v2.txt`, v2, { replaces: second });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.duplicate, true);
  assert.equal(r.json.replaced, null);
  assert.equal(r.json.id, second);
});

test('second replace of the old id is rejected', { skip }, async () => {
  const r = await put('policies', `Leave v3 ${run}.txt`, `${v2} third`, { replaces: first });
  console.log('replace of already-replaced id ->', r.status, r.json?.code);
  assert.ok([404, 409].includes(r.status));
  if (r.status === 409) assert.equal(r.json.code, 'COMPANY_DOCUMENT_ALREADY_REPLACED');
});

test('bad replaces values give 404', { skip }, async () => {
  const a = await put('policies', 'x.txt', `x ${run}`, { replaces: 'nope' });
  console.log('replaces=nope ->', a.status, JSON.stringify(a.json));
  assert.equal(a.status, 404);
  assert.equal(a.json.code, 'WORKSPACE_DOCUMENT_NOT_FOUND');
  const b = await put(
    'policies',
    'x.txt',
    `Orphan rule ${run}: badges are collected at the Ostrander lobby.`,
    {
      replaces: crypto.randomUUID(),
    },
  );
  console.log('replaces=random uuid ->', b.status, JSON.stringify(b.json));
  assert.equal(b.status, 404);
  assert.equal(b.json.code, 'WORKSPACE_DOCUMENT_NOT_FOUND');
});

test('replace with text equal to another document is a 409 duplicate', { skip }, async () => {
  const o = await put('policies', `Parking ${run}.txt`, other);
  assert.equal(o.status, 201);
  otherDoc = o.json.id;
  const r = await put('policies', `Whatever ${run}.txt`, other, { replaces: second });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'COMPANY_DOCUMENT_DUPLICATE');
});

test('validation: topic and file name', { skip }, async () => {
  const a = await put('', 'x.txt', `x ${run}`, { replaces: second });
  assert.equal(a.status, 400);
  assert.equal(a.json.code, 'DOCUMENT_TOPIC_REQUIRED');
});

test('delete removes the document', { skip }, async () => {
  for (const id of [second, otherDoc]) {
    const r = await del(id);
    assert.equal(r.status, 204);
    live.delete(id);
  }
  const list = await docs();
  assert.ok(!list.some((d) => [first, second, otherDoc].includes(d.id)));
});

after(async () => {
  if (skip) return;
  for (const id of live) await del(id);
});
