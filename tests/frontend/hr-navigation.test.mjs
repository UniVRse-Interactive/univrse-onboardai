import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultHrSection, visibleHrSections } from '../../src/access/hr-navigation.mjs';

test('signed-in HR sees all four sections in order, Settings last', () => {
  assert.deepEqual(
    visibleHrSections(true).map((s) => s.label),
    ['Employee accounts', 'People & Support', 'Company knowledge', 'Settings'],
  );
});

test('guest HR sees only People & Support and Company knowledge, never Settings', () => {
  assert.deepEqual(
    visibleHrSections(false).map((s) => s.label),
    ['People & Support', 'Company knowledge'],
  );
});

test('the first visible section opens by default', () => {
  assert.equal(defaultHrSection(true), 'accounts');
  assert.equal(defaultHrSection(false), 'people');
});

test('Settings is for signed-in HR only', () => {
  assert.ok(visibleHrSections(true).some((s) => s.id === 'settings'));
  assert.ok(!visibleHrSections(false).some((s) => s.id === 'settings'));
  assert.equal(visibleHrSections(true).at(-1).label, 'Settings');
});
