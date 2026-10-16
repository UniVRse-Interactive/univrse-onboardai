import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultHrSection, hrSections } from '../../src/access/hr-navigation.mjs';

test('HR sees all four sections in order, Settings last', () => {
  assert.deepEqual(
    hrSections.map((s) => s.label),
    ['Employee accounts', 'People & Support', 'Company Documentation', 'Settings'],
  );
  assert.equal(hrSections.at(-1).id, 'settings');
});

test('Employee accounts opens by default', () => {
  assert.equal(defaultHrSection(), 'accounts');
});
