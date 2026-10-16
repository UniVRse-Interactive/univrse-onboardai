import test from 'node:test';
import assert from 'node:assert/strict';
import { companyKnowledgeStatus } from '../../src/access/company-knowledge-status.mjs';

test('configured is ready with zero uploads and shows search connected', () => {
  const s = companyKnowledgeStatus({ state: 'configured', documents: [] }, 0);
  assert.equal(s.searchConnected, true);
  assert.equal(s.ready, true);
  assert.equal(s.indicator, 'Ready for Alya');
  assert.equal(s.warning, '');
});

test('unavailable surfaces the server error as a warning', () => {
  const s = companyKnowledgeStatus(
    { state: 'unavailable', documents: [], code: 'SEARCH_NOT_CONFIGURED', error: 'Fixed message.' },
    3,
  );
  assert.equal(s.unavailable, true);
  assert.equal(s.warning, 'Fixed message.');
  assert.equal(s.indicator, 'Connection needs attention');
  assert.equal(s.ready, false);
  assert.equal(s.searchConnected, false);
});

test('unavailable without error text still warns', () => {
  assert.ok(companyKnowledgeStatus({ state: 'unavailable' }, 0).warning);
});

test('not-configured keeps uploads-only behaviour', () => {
  const none = companyKnowledgeStatus({ state: 'not-configured', documents: [] }, 0);
  assert.equal(none.indicator, 'Awaiting documents');
  assert.equal(none.ready, false);
  assert.equal(none.searchConnected, false);
  const some = companyKnowledgeStatus({ state: 'not-configured', documents: [] }, 2);
  assert.equal(some.indicator, 'Ready for Alya');
  assert.equal(some.ready, true);
});

test('missing knowledge behaves like not-configured', () => {
  assert.equal(companyKnowledgeStatus(undefined, 0).indicator, 'Awaiting documents');
  assert.equal(companyKnowledgeStatus(null, 1).ready, true);
});
