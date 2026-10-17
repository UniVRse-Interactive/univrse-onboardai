import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyRedirect } from '../../src/access/legacy-paths.mjs';

test('legacy /mira and /guide URLs lead to /alya', () => {
  assert.equal(legacyRedirect('/mira'), '/alya');
  assert.equal(legacyRedirect('/mira/x'), '/alya');
  assert.equal(legacyRedirect('/guide'), '/alya');
  assert.equal(legacyRedirect('/guide/x'), '/alya');
});
test('older preview URLs lead to /alya', () => {
  for (const path of ['/chat', '/avatar-preview', '/about', '/resources'])
    assert.equal(legacyRedirect(path), '/alya');
});
test('current routes are not redirected', () => {
  assert.equal(legacyRedirect('/alya'), null);
  assert.equal(legacyRedirect('/dashboard'), null);
  assert.equal(legacyRedirect('/miranda'), null);
});

test('retired submission page redirects to the existing dashboard', () => {
  assert.equal(legacyRedirect('/documents'), '/dashboard');
});
