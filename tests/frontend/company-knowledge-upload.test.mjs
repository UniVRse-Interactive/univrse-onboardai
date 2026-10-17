import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  acceptAttribute,
  buildUploadRequest,
  knowledgeText,
  moveSuccessMessage,
  removeSuccessMessage,
  uploadSuccessMessage,
  validateDocumentName,
  validateUploadFile,
} from '../../src/access/company-knowledge-upload.mjs';

test('upload request: query string, headers and raw body', () => {
  const file = { name: 'Plan ü.docx', size: 5 };
  const req = buildUploadRequest('/api/hr/company-knowledge/', { category: 'policies' }, file);
  assert.equal(req.url, '/api/hr/company-knowledge/documents?category=policies');
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

test('the name is optional for every category and sent only when given', () => {
  const file = { name: 'a.pdf', size: 5 };
  assert.equal(
    buildUploadRequest('/b', { category: 'additional', name: '   ' }, file).url,
    '/b/documents?category=additional',
  );
  assert.equal(
    buildUploadRequest('/b', { category: 'additional' }, file).url,
    '/b/documents?category=additional',
  );
  assert.equal(
    buildUploadRequest('/b', { category: 'role-tools', name: 'Laptop set-up' }, file).url,
    '/b/documents?category=role-tools&name=Laptop+set-up',
  );
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

test('document name validation: blank is allowed, long or multi-line is not', () => {
  assert.equal(validateDocumentName('Workplace Safety'), '');
  assert.equal(validateDocumentName('x'.repeat(80)), '');
  assert.equal(validateDocumentName('   '), '');
  assert.equal(validateDocumentName(undefined), '');
  assert.match(validateDocumentName('x'.repeat(81)), /80/);
  assert.match(validateDocumentName('a\nb'), /single line/);
  assert.match(validateDocumentName('a\tb'), /single line/);
});

test('success messages: an upload adds or is already there, never replaced', () => {
  assert.equal(
    uploadSuccessMessage({ id: '1', duplicate: true }, 'a.pdf', 'Documentation'),
    'This document is already in Documentation.',
  );
  assert.equal(
    uploadSuccessMessage({ id: '1', duplicate: false }, 'a.pdf', 'Documentation'),
    'Uploaded a.pdf to Documentation. Alya will use it in the next answer.',
  );
  assert.match(uploadSuccessMessage({}, 'a.pdf'), /^Uploaded a\.pdf\. Alya/);
  assert.doesNotMatch(uploadSuccessMessage({ replaced: true }, 'a.pdf', 'X'), /Replaced/);
  assert.equal(
    moveSuccessMessage('Leave policy', 'Policies & Safe Practices'),
    'Moved “Leave policy” to Policies & Safe Practices.',
  );
  assert.match(removeSuccessMessage('Leave policy'), /^Removed “Leave policy”\./);
});

const source = (file) => readFileSync(new URL('../../src/access/' + file, import.meta.url), 'utf8');

test('company documentation page text and source never mention Google or Drive', () => {
  const sources = [
    'CompanyKnowledgeLibrary.jsx',
    'HrCompanyKnowledge.jsx',
    'company-knowledge-upload.mjs',
    'onboarding-document-status.mjs',
    'company-knowledge-api.mjs',
  ].map(source);
  for (const value of [JSON.stringify(knowledgeText), ...sources])
    assert.doesNotMatch(value, /google|drive|docs\.google/i);
});

test('the page speaks of five areas, never six guides, and confirms in the page', () => {
  assert.equal(knowledgeText.heading, 'Five areas. A clearer start.');
  const page = [source('CompanyKnowledgeLibrary.jsx'), source('HrCompanyKnowledge.jsx')].join('\n');
  assert.doesNotMatch(page + JSON.stringify(knowledgeText), /six guides|\/6|six onboarding/i);
  assert.match(source('HrCompanyKnowledge.jsx'), /Five onboarding areas/);
  // Remove asks inside the page, not with a browser dialog.
  assert.doesNotMatch(page, /window\.confirm|\bconfirm\(/);
  // Uploads add; nothing on the page offers to replace a document.
  assert.doesNotMatch(JSON.stringify(knowledgeText), /replace/i);
  assert.doesNotMatch(source('company-knowledge-upload.mjs'), /replaced/);
});
