import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addedMessage,
  archiveNote,
  editNotes,
  hasChanges,
  nameProblem,
  normalizePrefix,
  patchBody,
  prefixPreview,
  prefixProblem,
  problemMessage,
  savedMessage,
  serverDepartmentErrors,
  statusLabel,
  validateDepartmentForm,
} from '../../src/access/department-settings.mjs';
import { AccountApiError } from '../../src/access/account-api.mjs';

const existing = [
  { id: 'd1', name: 'Finance', prefix: 'FN', archived: false },
  { id: 'd2', name: 'Legal', prefix: 'LG', archived: true },
];

test('prefix is uppercased and kept to 4 characters', () => {
  assert.equal(normalizePrefix('fn'), 'FN');
  assert.equal(normalizePrefix('abcdef'), 'ABCD');
  assert.equal(normalizePrefix(undefined), '');
});

test('name rules: required, 60 characters, one line, unique ignoring case', () => {
  assert.equal(nameProblem('  ', existing), 'required');
  assert.equal(nameProblem('x'.repeat(60), existing), null);
  assert.equal(nameProblem('x'.repeat(61), existing), 'too_long');
  assert.equal(nameProblem('Two\nlines', existing), 'invalid_format');
  assert.equal(nameProblem('finance', existing), 'taken');
  assert.equal(nameProblem(' LEGAL ', existing), 'taken');
  assert.equal(nameProblem('finance', existing, 'd1'), null);
  assert.equal(nameProblem('Sales', existing), null);
});

test('prefix rules: 2 to 4 capitals, HR reserved, unique including archived', () => {
  assert.equal(prefixProblem('', existing), 'required');
  assert.equal(prefixProblem('A', existing), 'invalid_format');
  assert.equal(prefixProblem('A1', existing), 'invalid_format');
  assert.equal(prefixProblem('ab', existing), null);
  assert.equal(prefixProblem('abcd', existing), null);
  assert.equal(prefixProblem('hr', existing), 'reserved');
  assert.equal(prefixProblem('fn', existing), 'taken');
  assert.equal(prefixProblem('lg', existing), 'taken');
  assert.equal(prefixProblem('lg', existing, 'd2'), null);
});

test('form validation maps each problem to its input', () => {
  assert.deepEqual(validateDepartmentForm({ name: 'Sales', prefix: 'sl' }, existing), {});
  const errors = validateDepartmentForm({ name: '', prefix: 'HR' }, existing);
  assert.equal(errors.name, problemMessage('name', 'required'));
  assert.match(errors.prefix, /HR is reserved/);
});

test('server fields and 409s land on the right input', () => {
  const invalid = new AccountApiError({
    status: 400,
    code: 'DEPARTMENT_INVALID',
    fields: [
      { field: 'name', problem: 'too_long' },
      { field: 'prefix', problem: 'reserved' },
    ],
  });
  const mapped = serverDepartmentErrors(invalid);
  assert.equal(mapped.errors.name, problemMessage('name', 'too_long'));
  assert.equal(mapped.errors.prefix, problemMessage('prefix', 'reserved'));
  assert.equal(mapped.summary, '');
  assert.deepEqual(Object.keys(serverDepartmentErrors({ code: 'DEPARTMENT_NAME_TAKEN' }).errors), [
    'name',
  ]);
  assert.deepEqual(
    Object.keys(serverDepartmentErrors({ code: 'DEPARTMENT_PREFIX_TAKEN' }).errors),
    ['prefix'],
  );
  const other = serverDepartmentErrors({
    code: 'PROFILE_STORAGE_UNAVAILABLE',
    message: 'Try later',
  });
  assert.deepEqual(other, { errors: {}, summary: 'Try later' });
  const unknownField = serverDepartmentErrors({
    code: 'DEPARTMENT_INVALID',
    message: 'Bad',
    fields: [{ field: 'other', problem: 'required' }],
  });
  assert.equal(unknownField.summary, 'Bad');
});

test('live preview of the ID format', () => {
  assert.equal(prefixPreview(''), 'IDs look like XX-0001');
  assert.equal(prefixPreview('ab'), 'IDs look like AB-0001');
});

test('edit notes appear only for changes', () => {
  const original = { name: 'Finance', prefix: 'FN' };
  assert.deepEqual(editNotes(original, { name: 'Finance', prefix: 'fn' }), {});
  assert.equal(
    editNotes(original, { name: 'Finance', prefix: 'fx' }).prefix,
    'Existing Employee IDs stay the same. New hires get FX-…',
  );
  assert.equal(
    editNotes(original, { name: 'Money', prefix: 'FN' }).name,
    'Employees in this department will be relabelled.',
  );
  assert.deepEqual(editNotes(original, { name: '', prefix: '' }), {});
});

test('PATCH body holds only what changed', () => {
  const original = { name: 'Finance', prefix: 'FN' };
  assert.equal(hasChanges(original, { name: 'Finance ', prefix: 'fn' }), false);
  assert.deepEqual(patchBody(original, { name: ' Money ', prefix: 'FN' }), { name: 'Money' });
  assert.deepEqual(patchBody(original, { name: 'Finance', prefix: 'fx' }), { prefix: 'FX' });
});

test('status messages', () => {
  assert.equal(savedMessage('Money', 3), 'Saved Money. 3 employee profiles updated.');
  assert.equal(savedMessage('Money', 1), 'Saved Money. 1 employee profile updated.');
  assert.equal(savedMessage('Money'), 'Saved Money. 0 employee profiles updated.');
  assert.match(addedMessage({ name: 'Sales', prefix: 'SL' }), /SL-/);
  assert.match(archiveNote({ name: 'Legal' }), /hidden from the department choices for new hires/);
  assert.match(archiveNote({ name: 'Legal' }), /keep it/);
  assert.equal(statusLabel({ archived: true }), 'Archived');
  assert.equal(statusLabel({ archived: false }), 'Active');
});
