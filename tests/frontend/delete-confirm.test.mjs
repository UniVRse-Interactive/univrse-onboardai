import test from 'node:test';
import assert from 'node:assert/strict';
import { canConfirmDelete, deleteErrorMessage } from '../../src/access/delete-confirm.mjs';

test('the typed ID must match exactly', () => {
  assert.equal(canConfirmDelete('EMP-0001', 'EMP-0001'), true);
  assert.equal(canConfirmDelete('EMP-000', 'EMP-0001'), false);
  assert.equal(canConfirmDelete('EMP-00011', 'EMP-0001'), false);
  assert.equal(canConfirmDelete('', 'EMP-0001'), false);
});

test('matching is case-sensitive', () => {
  assert.equal(canConfirmDelete('emp-0001', 'EMP-0001'), false);
});

test('surrounding whitespace is ignored, inner whitespace is not', () => {
  assert.equal(canConfirmDelete('  EMP-0001 ', 'EMP-0001'), true);
  assert.equal(canConfirmDelete('EMP -0001', 'EMP-0001'), false);
});

test('an empty employee ID never enables the button', () => {
  assert.equal(canConfirmDelete('', ''), false);
  assert.equal(canConfirmDelete('x', undefined), false);
});

test('storage errors say to try again', () => {
  for (const code of ['PROFILE_STORAGE_UNAVAILABLE', 'PROFILE_STORAGE_TIMEOUT'])
    assert.equal(deleteErrorMessage({ code, message: 'internal' }), 'Couldn’t delete; try again.');
  assert.equal(deleteErrorMessage({ status: 504 }), 'Couldn’t delete; try again.');
});

test('not found explains the account is already gone', () => {
  assert.match(deleteErrorMessage({ code: 'EMPLOYEE_NOT_FOUND' }), /no longer exists/);
});
