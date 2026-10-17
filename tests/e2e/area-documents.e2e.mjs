// Issue #68: the five document areas on the HR Company Documentation API.
// Needs a live app: BASE_URL, HR_ID and HR_PASSWORD (a local HR account).
// Adds its own two small text documents and removes them again.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { client } from './qa-lib.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:3130';
const { HR_ID, HR_PASSWORD } = process.env;
const hr = client(base);
const run = Date.now().toString(36);
const textA = `Zorblax cafeteria rule ${run}: lunch tokens are issued at the Plinth Annex on Thursdays only.`;
const textB = `Quillfeather travel rule ${run}: flights over six hours may be booked in premium economy when the Tessellate desk approves.`;
const created = [];

// qa-lib only sends JSON, so uploads are raw fetches with the HR cookie.
async function put(category, fileName, text, name) {
  await hr.get('/api/hr/company-knowledge');
  const cookie = hr.cookie();
  const q = new URLSearchParams({ category, ...(name ? { name } : {}) });
  const res = await fetch(`${base}/api/hr/company-knowledge/documents?${q}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent(fileName),
      origin: base,
      cookie,
    },
    body: Buffer.from(text),
  });
  const json = await res.json().catch(() => null);
  if (json?.id && !json.duplicate) created.push(json.id);
  return { status: res.status, json };
}

const names = [
  [
    'alignment',
    'Company Purpose & Alignment',
    'Understand what the company does, its goals and how your role contributes.',
  ],
  ['documentation', 'Documentation', 'Complete required forms and submit documents.'],
  [
    'team-support',
    'People & Workplace Support',
    'Know your teammates, who to ask for help and optionally share working preferences or support needs.',
  ],
  [
    'role-tools',
    'Role, Tools & AI Readiness',
    'Set up work tools, understand your responsibilities and identify suitable AI training.',
  ],
  [
    'policies',
    'Policies & Safe Practices',
    'Understand company rules, privacy and responsible AI use.',
  ],
];

test('sign in as HR', { skip: !HR_ID || !HR_PASSWORD }, async () => {
  const r = await hr.post('/api/auth/sign-in', { username: HR_ID, password: HR_PASSWORD });
  assert.equal(r.status, 200);
});

test('snapshot lists the five areas in order', async () => {
  const r = await hr.get('/api/hr/company-knowledge');
  assert.equal(r.status, 200);
  assert.equal(r.json.topics.length, 5);
  r.json.topics.forEach((t, i) => {
    assert.equal(t.id, names[i][0]);
    assert.equal(t.title, names[i][1]);
    assert.equal(t.description, names[i][2]);
    assert.ok(t.icon);
  });
});

let a, b;
test('two uploads into one area both stay, with their own titles', async () => {
  a = await put('policies', `QA Cafeteria ${run}.txt`, textA);
  b = await put('policies', `QA Travel ${run}.txt`, textB, `QA Travel Rules ${run}`);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const snap = (await hr.get('/api/hr/company-knowledge')).json;
  const da = snap.documents.find((d) => d.id === a.json.id);
  const db = snap.documents.find((d) => d.id === b.json.id);
  assert.equal(da.category, 'policies');
  assert.equal(da.title, `QA Cafeteria ${run}`);
  assert.equal(db.title, `QA Travel Rules ${run}`);
  assert.equal(db.fileName, `QA Travel ${run}.txt`);
  assert.equal(da.text, undefined);
});

test('same file in the same area is a duplicate, no copy', async () => {
  const before = (await hr.get('/api/hr/company-knowledge')).json.documents.length;
  const r = await put('policies', `QA Cafeteria again ${run}.txt`, textA);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { id: a.json.id, duplicate: true });
  assert.equal((await hr.get('/api/hr/company-knowledge')).json.documents.length, before);
});

test('same file in another area is a 409', async () => {
  const r = await put('documentation', `QA Cafeteria again ${run}.txt`, textA);
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'COMPANY_DOCUMENT_DUPLICATE');
  assert.match(r.json.error, /already in the company library in another area/i);
});

test('bad upload requests are refused', async () => {
  assert.equal((await put('six-guides', 'x.txt', 'some text')).status, 400);
  assert.equal((await put('policies', 'x.txt', 'some text', 'bad\nname')).status, 400);
  assert.equal((await put('policies', 'x.txt', 'some text', 'n'.repeat(81))).status, 400);
});

test('moving a document to another area works; same area and bad input behave', async () => {
  const path = `/api/hr/company-knowledge/documents/${a.json.id}`;
  let r = await hr.patch(path, { category: 'role-tools' });
  assert.equal(r.status, 200);
  assert.equal(r.json.document.category, 'role-tools');
  assert.equal(r.json.document.title, `QA Cafeteria ${run}`);
  r = await hr.patch(path, { category: 'role-tools' });
  assert.equal(r.status, 200);
  assert.equal((await hr.patch(path, { category: 'handbook' })).status, 400);
  assert.equal((await hr.patch(path, {})).status, 400);
  assert.equal(
    (await hr.patch('/api/hr/company-knowledge/documents/nope', { category: 'additional' })).status,
    404,
  );
  r = await hr.patch(path, { category: 'policies' });
  assert.equal(r.json.document.category, 'policies');
});

test('removing one document leaves the other', async () => {
  const res = await fetch(`${base}/api/hr/company-knowledge/documents/${b.json.id}`, {
    method: 'DELETE',
    headers: { origin: base, cookie: hr.cookie() },
  });
  assert.equal(res.status, 204);
  created.splice(created.indexOf(b.json.id), 1);
  const ids = (await hr.get('/api/hr/company-knowledge')).json.documents.map((d) => d.id);
  assert.ok(ids.includes(a.json.id));
  assert.ok(!ids.includes(b.json.id));
});

after(async () => {
  for (const id of created)
    await fetch(`${base}/api/hr/company-knowledge/documents/${id}`, {
      method: 'DELETE',
      headers: { origin: base, cookie: hr.cookie() },
    }).catch(() => {});
});
