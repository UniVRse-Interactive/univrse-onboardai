import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  acceptAttribute,
  buildUploadRequest,
  knowledgeText,
  uploadSuccessMessage,
  validateAdditionalName,
  validateUploadFile,
} from '../../src/access/company-knowledge-upload.mjs';
import {
  connectedOnboardingTopics,
  documentLabel,
  relatedDocuments,
} from '../../src/access/onboarding-document-status.mjs';

test('upload request: query string, headers and raw body', () => {
  const file = { name: 'Plan ü.docx', size: 5 };
  const req = buildUploadRequest('/api/hr/company-knowledge/', { category: 'handbook' }, file);
  assert.equal(req.url, '/api/hr/company-knowledge/documents?category=handbook');
  assert.equal(req.method, 'POST');
  assert.equal(req.headers['Content-Type'], 'application/octet-stream');
  assert.equal(req.headers['X-File-Name'], encodeURIComponent('Plan ü.docx'));
  assert.equal(req.rawBody, file);
  const extra = buildUploadRequest(
    '/b',
    { category: 'additional', name: ' Workplace Safety ' },
    file,
  );
  assert.equal(extra.url, '/b/documents?category=additional&name=Workplace+Safety');
});

test('client file checks', () => {
  assert.equal(acceptAttribute, '.pdf,.docx,.txt,.md');
  for (const name of ['a.pdf', 'a.DOCX', 'a.txt', 'a.md'])
    assert.equal(validateUploadFile({ name, size: 100 }), '');
  assert.match(validateUploadFile({ name: 'a.exe', size: 1 }), /PDF/);
  assert.match(validateUploadFile({ name: 'noext', size: 1 }), /PDF/);
  assert.match(validateUploadFile({ name: 'a.pdf', size: 5 * 1024 * 1024 + 1 }), /5 MB/);
  assert.equal(validateUploadFile({ name: 'a.pdf', size: 5 * 1024 * 1024 }), '');
  assert.match(validateUploadFile({ name: 'a.pdf', size: 0 }), /empty/);
  assert.match(validateUploadFile(null), /Choose/);
});

test('additional guide name validation', () => {
  assert.equal(validateAdditionalName('Workplace Safety'), '');
  assert.equal(validateAdditionalName('x'.repeat(80)), '');
  assert.notEqual(validateAdditionalName('x'.repeat(81)), '');
  assert.notEqual(validateAdditionalName('   '), '');
  assert.notEqual(validateAdditionalName(undefined), '');
  assert.notEqual(validateAdditionalName('a\nb'), '');
});

test('topic status from the snapshot, including legacy empty fileName', () => {
  const documents = [
    { id: '1', title: 'Handbook', fileName: 'handbook.pdf', category: 'handbook', characters: 10 },
    { id: '2', title: 'Old IT', fileName: '', category: 'it', characters: 5 },
    { id: '3', title: 'Safety', fileName: 'safety.md', category: 'additional', characters: 7 },
  ];
  const connected = connectedOnboardingTopics(documents);
  assert.deepEqual(Object.keys(connected).sort(), ['handbook', 'it']);
  assert.equal(documentLabel(connected.handbook), 'handbook.pdf');
  assert.equal(documentLabel(connected.it), 'Old IT');
  assert.equal(documentLabel({ fileName: '', title: '' }), 'Uploaded document');
  assert.deepEqual(
    relatedDocuments(documents).map((d) => d.id),
    ['3'],
  );
  assert.deepEqual(connectedOnboardingTopics(undefined), {});
});

test('success messages', () => {
  assert.match(uploadSuccessMessage({ duplicate: true }, 'a.pdf'), /already/);
  assert.match(uploadSuccessMessage({ replaced: true }, 'a.pdf'), /Replaced/);
  assert.match(uploadSuccessMessage({}, 'a.pdf'), /Uploaded a.pdf/);
});

test('company knowledge page text and source never mention Google or Drive', () => {
  const sources = [
    'CompanyKnowledgeLibrary.jsx',
    'HrCompanyKnowledge.jsx',
    'company-knowledge-upload.mjs',
    'onboarding-document-status.mjs',
    'company-knowledge-api.mjs',
  ].map((file) => readFileSync(new URL('../../src/access/' + file, import.meta.url), 'utf8'));
  for (const value of [JSON.stringify(knowledgeText), ...sources])
    assert.doesNotMatch(value, /google|drive|docs\.google/i);
});
