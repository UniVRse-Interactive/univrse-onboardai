import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyProfile,
  employeeErrorTarget,
  fieldErrors,
  formToProfileInput,
  passwordProblem,
  profileToForm,
  validateNewEmployee,
  validateProfileForm,
} from '../../src/access/profile-validation.mjs';
import {
  accountBadges,
  employeeNames,
  profileSections,
} from '../../src/access/profile-display.mjs';

const valid = () => {
  const f = emptyProfile();
  f.job.fullName = 'Test Person';
  return f;
};

test('only full name is required', () => {
  assert.deepEqual(validateProfileForm(emptyProfile()), [
    { field: 'job.fullName', problem: 'required' },
  ]);
  assert.deepEqual(validateProfileForm(valid()), []);
});
test('limits mirror the server', () => {
  const f = valid();
  f.job.fullName = 'x'.repeat(121);
  f.job.preferredName = 'x'.repeat(81);
  f.homeAddress.line1 = 'x'.repeat(201);
  f.homeAddress.postcode = 'x'.repeat(21);
  f.contact.workEmail = 'nope';
  f.contact.mobileNumber = 'abc';
  f.emergencyContact.phoneNumber = '+60 (12) 345-678';
  f.job.startDate = '2026-02-30';
  const got = Object.fromEntries(validateProfileForm(f).map((p) => [p.field, p.problem]));
  assert.deepEqual(got, {
    'job.fullName': 'too_long',
    'job.preferredName': 'too_long',
    'job.startDate': 'invalid_date',
    'contact.workEmail': 'invalid_email',
    'contact.mobileNumber': 'invalid_phone',
    'homeAddress.line1': 'too_long',
    'homeAddress.postcode': 'too_long',
  });
});
test('control characters rejected, values trimmed', () => {
  const f = valid();
  f.job.manager = 'a\nb';
  assert.equal(validateProfileForm(f)[0].problem, 'invalid_characters');
  f.job.manager = '  Boss  ';
  assert.equal(formToProfileInput(f).job.manager, 'Boss');
});
test('profileToForm fills missing fields and drops server fields', () => {
  const form = profileToForm({ job: { fullName: 'A' }, updatedAt: 'x' });
  assert.equal(form.job.fullName, 'A');
  assert.equal(form.homeAddress.country, '');
  assert.equal(form.updatedAt, undefined);
  assert.equal(profileToForm(null).job.fullName, '');
});
test('PROFILE_INVALID fields map to inputs', () => {
  const { errors, general } = fieldErrors([
    { field: 'job.startDate', problem: 'invalid_date' },
    { field: 'contact.workEmail', problem: 'invalid_email' },
    { field: 'job.fullName', problem: 'too_long' },
    { field: 'profile', problem: 'not_object' },
  ]);
  assert.match(errors['job.startDate'], /Start date/);
  assert.match(errors['contact.workEmail'], /Work email/);
  assert.match(errors['job.fullName'], /at most 120/);
  assert.equal(general.length, 1);
});
test('new employee validation', () => {
  assert.deepEqual(
    Object.keys(validateNewEmployee({ username: 'a', temporaryPassword: '', confirmation: '' })),
    ['username', 'temporaryPassword'],
  );
  assert.deepEqual(
    validateNewEmployee({ username: 'FE-01', temporaryPassword: 'longenough1', confirmation: 'x' }),
    { confirmation: 'The passwords do not match.' },
  );
  assert.deepEqual(
    validateNewEmployee({
      username: 'FE-01',
      temporaryPassword: 'longenough1',
      confirmation: 'longenough1',
    }),
    {},
  );
  assert.ok(passwordProblem('fe-01-fe-01'.slice(0, 5), 'x'));
  assert.ok(passwordProblem('abcdefgh', 'ABCDEFGH'));
});
test('server error codes target inputs', () => {
  assert.equal(employeeErrorTarget('USERNAME_TAKEN'), 'username');
  assert.equal(employeeErrorTarget('PASSWORD_REJECTED'), 'temporaryPassword');
  assert.equal(employeeErrorTarget('PROFILE_INVALID'), null);
});
test('display helpers', () => {
  assert.deepEqual(accountBadges({ status: 'disabled', mustChangePassword: true, locked: true }), [
    'Disabled',
    'Must change password',
    'Locked',
  ]);
  assert.deepEqual(accountBadges({ status: 'active' }), ['Active']);
  assert.deepEqual(employeeNames({ fullName: 'A B', preferredName: 'A B' }), {
    fullName: 'A B',
    preferredName: '',
  });
  assert.equal(profileSections(null).length, 4);
});
