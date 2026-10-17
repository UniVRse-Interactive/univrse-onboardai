import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUploadRequest,
  errorNeedsRefresh,
  findSameTitleDocument,
  formatUploadedDate,
  knowledgeErrorMessage,
  normaliseTitle,
  replaceSuccessMessage,
  sameTitlePrompt,
  versionLine,
} from '../../src/access/company-knowledge-upload.mjs';
import { createKnowledgeApi } from '../../src/access/company-knowledge-api.mjs';
import { askHrOffer, noAnswerNote } from '../../src/access/support-flow.mjs';
import { answerPresentation } from '../../src/avatar/answer-presentation.mjs';

test('normaliseTitle drops case, extension and spacing', () => {
  assert.equal(normaliseTitle('  Employee   Handbook.PDF '), 'employee handbook');
  assert.equal(normaliseTitle('Employee_Handbook.docx'), 'employee handbook');
  assert.equal(normaliseTitle('notes.md'), 'notes');
});

test('normaliseTitle strips one trailing version token', () => {
  for (const title of [
    'Handbook v2',
    'Handbook V12',
    'Handbook version 3',
    'Handbook rev 4',
    'Handbook (2)',
    'Handbook(2)',
    'Handbook final',
    'Handbook DRAFT',
    'Handbook 2026-03',
    'Handbook 2026-03-14',
    'Handbook_2026.03.14.pdf',
    'Handbook-v2.docx',
  ])
    assert.equal(normaliseTitle(title), 'handbook', title);
  assert.equal(normaliseTitle('Handbook final v2'), 'handbook final');
});

test('normaliseTitle keeps words that merely end like a token', () => {
  assert.equal(normaliseTitle('Wfinal'), 'wfinal');
  assert.equal(normaliseTitle('Leave policy 2'), 'leave policy 2');
  assert.equal(normaliseTitle('v2'), 'v2');
});

const docs = [
  { id: 'a', title: 'Leave Policy', created: 1 },
  { id: 'b', title: 'leave policy v2', fileName: 'x.pdf', created: 2 },
  { id: 'c', title: '', fileName: 'Benefits Guide.pdf', created: 3 },
];

test('findSameTitleDocument matches within the given list and prefers the newest', () => {
  assert.equal(findSameTitleDocument(docs, { fileName: 'Leave policy (3).pdf' }).id, 'b');
  assert.equal(findSameTitleDocument(docs, { fileName: 'benefits guide final.docx' }).id, 'c');
  assert.equal(findSameTitleDocument(docs, { name: 'Leave Policy', fileName: 'z.pdf' }).id, 'b');
  assert.equal(findSameTitleDocument(docs, { name: 'Other', fileName: 'Leave Policy.pdf' }), null);
  assert.equal(findSameTitleDocument([], { fileName: 'Leave Policy.pdf' }), null);
  assert.equal(findSameTitleDocument(undefined, { fileName: 'a.pdf' }), null);
});

test('the other area titles are never consulted', () => {
  const area = docs.filter((d) => d.id === 'c');
  assert.equal(findSameTitleDocument(area, { fileName: 'Leave Policy.pdf' }), null);
});

test('date and prompt wording', () => {
  assert.equal(formatUploadedDate({ connectedAt: '2026-03-03T10:00:00Z' }), '3 March 2026');
  assert.equal(
    formatUploadedDate({ connectedAt: null, created: Date.UTC(2025, 11, 25) }),
    '25 December 2025',
  );
  assert.equal(formatUploadedDate({ connectedAt: 'junk' }), '');
  assert.equal(
    sameTitlePrompt({ title: 'Leave Policy', connectedAt: '2026-03-03T10:00:00Z' }),
    "Replace 'Leave Policy' (uploaded 3 March 2026) with this file, or add it as a separate document?",
  );
  assert.equal(
    versionLine({ version: 3, connectedAt: '2026-03-03T10:00:00Z' }),
    'Version 3 · Uploaded 3 March 2026',
  );
  assert.equal(
    versionLine({ created: Date.UTC(2026, 0, 2) }),
    'Version 1 · Uploaded 2 January 2026',
  );
});

test('replace request carries replaces and category, and no name by default', () => {
  const file = { name: 'New.pdf' };
  const request = buildUploadRequest(
    '/api/hr/company-knowledge/',
    { category: 'policies', replaces: 'id-1' },
    file,
  );
  assert.equal(request.method, 'POST');
  assert.equal(request.url, '/api/hr/company-knowledge/documents?category=policies&replaces=id-1');
  assert.equal(request.headers['X-File-Name'], 'New.pdf');
  assert.equal(request.rawBody, file);
  const named = buildUploadRequest(
    '/b',
    { category: 'additional', name: 'Safety', replaces: 'x' },
    file,
  );
  assert.equal(named.url, '/b/documents?category=additional&name=Safety&replaces=x');
  assert.ok(!buildUploadRequest('/b', { category: 'c' }, file).url.includes('replaces'));
});

test('the adapter passes replaces through', async () => {
  const calls = [];
  const api = createKnowledgeApi(
    '/api/hr/company-knowledge',
    async (url, o) => (calls.push(url), {}),
  );
  await api.upload({ name: 'a.pdf' }, { category: 'policies', replaces: 'id-9' });
  assert.equal(calls[0], '/api/hr/company-knowledge/documents?category=policies&replaces=id-9');
});

test('replace responses and errors', () => {
  const ok = 'The new version will be searchable in about a minute.';
  assert.equal(
    replaceSuccessMessage({ id: 'n', duplicate: false, replaced: { id: 'o', cleanup: 'done' } }),
    ok,
  );
  assert.equal(
    replaceSuccessMessage({ id: 'n', duplicate: false, replaced: { id: 'o', cleanup: 'pending' } }),
    ok,
  );
  assert.match(replaceSuccessMessage({ id: 'o', duplicate: true, replaced: null }), /identical/);

  const already = Object.assign(
    new Error('This document was just replaced. Refresh the library and try again.'),
    {
      status: 409,
      code: 'COMPANY_DOCUMENT_ALREADY_REPLACED',
    },
  );
  assert.equal(knowledgeErrorMessage(already, 'replace'), already.message);
  assert.ok(errorNeedsRefresh(already));
  const missing = Object.assign(new Error('Not found'), {
    status: 404,
    code: 'WORKSPACE_DOCUMENT_NOT_FOUND',
  });
  assert.ok(errorNeedsRefresh(missing));
  assert.match(knowledgeErrorMessage(missing, 'replace'), /already removed/);
  assert.match(
    knowledgeErrorMessage(Object.assign(new Error(''), { status: 503 }), 'replace'),
    /could not be replaced/,
  );
});

test('stale Ask HR note', () => {
  const none = { role: 'assistant', coverage: 'none', text: 'x' };
  const stale = { ...none, guardrail: { verdict: 'stale', askHr: true } };
  assert.equal(askHrOffer(stale), 'no-answer');
  assert.equal(
    noAnswerNote(stale),
    'These company documents are out of date. HR can confirm the current guidance.',
  );
  assert.equal(
    noAnswerNote(none),
    'I couldn’t find this in the company documents. HR may be able to help.',
  );
  assert.equal(noAnswerNote({ ...none, guardrail: null }), noAnswerNote(none));
  assert.equal(
    noAnswerNote({ ...none, guardrail: { verdict: 'ok', askHr: false } }),
    noAnswerNote(none),
  );
});

test('the stale reply text still gets the uncertain visual', () => {
  const text =
    "The company documents I have on this are out of date, so I won't rely on them. Please check with HR for the latest guidance.";
  const message = {
    role: 'assistant',
    text,
    reply: text,
    category: 'onboarding',
    coverage: 'none',
    passages: [],
  };
  const scenes = answerPresentation(message).scenes;
  const hr = scenes.find((scene) => scene.body.includes('check with HR'));
  assert.equal(hr.label, 'Check company guidance');
  assert.equal(hr.eyebrow, 'CONFIRM WITH YOUR COMPANY');
});
