import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultHrSection, visibleHrSections } from '../../src/access/hr-navigation.mjs';

test('signed-in HR sees all three sections in order', () => {
  assert.deepEqual(
    visibleHrSections(true).map((s) => s.label),
    ['Employee accounts', 'People & Support', 'Company knowledge'],
  );
});

test('guest HR sees only People & Support and Company knowledge', () => {
  assert.deepEqual(
    visibleHrSections(false).map((s) => s.label),
    ['People & Support', 'Company knowledge'],
  );
});

test('the first visible section opens by default', () => {
  assert.equal(defaultHrSection(true), 'accounts');
  assert.equal(defaultHrSection(false), 'people');
});
