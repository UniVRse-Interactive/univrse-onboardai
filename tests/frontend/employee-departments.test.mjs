import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  copyBothText,
  copyStatusMessage,
  copyToClipboard,
  createEmployeeBody,
  departmentOptions,
  departmentProblem,
  idFormatHint,
  manualCopyMessage,
  selectedDepartment,
} from '../../src/access/employee-departments.mjs';
import { departments } from '../../server/departments.mjs';
import { formToProfileInput, profileToForm } from '../../src/access/profile-validation.mjs';

test('six department options, in order', () => {
  const options = departmentOptions();
  assert.equal(options.length, 6);
  assert.deepEqual(
    options.map((o) => o.value),
    departments.map((d) => d.name),
  );
});

test('legacy department text becomes a first "(current)" option', () => {
  const options = departmentOptions('Old Dept');
  assert.equal(options.length, 7);
  assert.deepEqual(options[0], { value: 'Old Dept', label: 'Old Dept (current)', legacy: true });
  assert.equal(selectedDepartment('Old Dept', 'Old Dept'), 'Old Dept');
  assert.equal(departmentOptions('Finance').length, 6);
  assert.equal(departmentOptions('  ').length, 6);
  assert.equal(selectedDepartment('Finance', 'Old Dept'), 'Finance');
  assert.equal(selectedDepartment('Unknown', ''), '');
});

test('department is required on the add form', () => {
  assert.ok(departmentProblem(profileToForm(null)));
  assert.ok(departmentProblem({ job: { department: 'Made up' } }));
  const form = profileToForm({ job: { department: 'Finance' } });
  assert.equal(departmentProblem(form), null);
});

test('ID format hint per department', () => {
  for (const { name, prefix } of departments)
    assert.equal(idFormatHint(name), `IDs look like ${prefix}-0001`);
  assert.equal(idFormatHint(''), '');
  assert.equal(idFormatHint('Other'), '');
});

test('create request body holds only the profile', () => {
  const profile = formToProfileInput(
    profileToForm({ job: { fullName: 'A', department: 'Finance' } }),
  );
  const body = createEmployeeBody(profile);
  assert.deepEqual(Object.keys(body), ['profile']);
  assert.equal(body.profile.job.department, 'Finance');
});

test('Copy both text', () => {
  assert.equal(
    copyBothText({ username: 'PE-0001', temporaryPassword: 'abc def' }),
    'Employee ID: PE-0001\nTemporary password: abc def',
  );
});

test('clipboard fallback decision', async () => {
  const written = [];
  const ok = { writeText: async (text) => written.push(text) };
  assert.deepEqual(await copyToClipboard('x', ok), { copied: true, fallback: false });
  assert.deepEqual(written, ['x']);
  const denied = {
    writeText: async () => {
      throw new Error('denied');
    },
  };
  assert.deepEqual(await copyToClipboard('x', denied), { copied: false, fallback: true });
  assert.deepEqual(await copyToClipboard('x', undefined), { copied: false, fallback: true });
  assert.deepEqual(await copyToClipboard('x', {}), { copied: false, fallback: true });
  assert.equal(copyStatusMessage('password', { copied: true }), 'Copied password');
  assert.equal(copyStatusMessage('password', { copied: false }), manualCopyMessage);
});
