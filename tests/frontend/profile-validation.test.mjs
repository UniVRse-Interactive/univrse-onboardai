import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyProfile,
  employeeErrorTarget,
  fieldErrors,
  formToProfileInput,
  passwordProblem,
  profileToForm,
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
test('password rules still apply to reset', () => {
  assert.ok(passwordProblem('short', 'x'));
  assert.ok(passwordProblem('abcdefgh', 'ABCDEFGH'));
  assert.equal(passwordProblem('longenough1', 'x'), null);
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

test('a shown error clears when its field gets a valid value', async () => {
  const { clearResolvedErrors, profileToForm } =
    await import('../../src/access/profile-validation.mjs');
  const { mergeAutofill } = await import('../../src/access/profile-autofill.mjs');
  const before = profileToForm({ job: { fullName: 'Ada' } });
  const errors = {
    'job.department': 'Choose a department.',
    'contact.workEmail': 'Work email must be a valid email address.',
    'job.jobTitle': 'Job title is required.',
  };
  // autofill fills department and a valid email, leaves the job title empty
  const filled = mergeAutofill(before, {
    profile: { job: { department: 'Finance' }, contact: { workEmail: 'ada@example.com' } },
    filled: ['job.department', 'contact.workEmail'],
  });
  const after = clearResolvedErrors(errors, before, filled.form);
  assert.deepEqual(after, { 'job.jobTitle': 'Job title is required.' });
  assert.notEqual(after, errors);
  // manual change of the select
  const chosen = profileToForm({ job: { fullName: 'Ada', department: 'Finance' } });
  assert.deepEqual(clearResolvedErrors({ 'job.department': 'x' }, before, chosen), {});
  // an invalid new value keeps the error; an unchanged field keeps it too
  const bad = profileToForm({ job: { fullName: 'Ada' }, contact: { workEmail: 'nope' } });
  const kept = { 'contact.workEmail': 'bad' };
  assert.equal(clearResolvedErrors(kept, before, bad), kept);
  assert.equal(
    clearResolvedErrors({ 'job.department': 'x' }, before, before)['job.department'],
    'x',
  );
  assert.deepEqual(clearResolvedErrors({}, before, bad), {});
});

test('Track defaults to Employee and only accepts the three tracks', () => {
  assert.equal(emptyProfile().job.track, 'employee');
  assert.equal(profileToForm(null).job.track, 'employee');
  assert.equal(profileToForm({ job: { track: 'intern' } }).job.track, 'intern');
  assert.equal(profileToForm({ job: { track: 'boss' } }).job.track, 'employee');
  const f = valid();
  f.job.track = 'contractor';
  assert.deepEqual(validateProfileForm(f), []);
  assert.equal(formToProfileInput(f).job.track, 'contractor');
  f.job.track = '';
  assert.equal(formToProfileInput(f).job.track, 'employee');
  f.job.track = 'boss';
  assert.deepEqual(validateProfileForm(f), [{ field: 'job.track', problem: 'invalid_track' }]);
  assert.equal(
    fieldErrors([{ field: 'job.track', problem: 'invalid_track' }]).errors['job.track'],
    'Track must be Employee, Intern or Contractor.',
  );
});
test('My profile shows the track by name', () => {
  const rows = profileSections({ job: { track: 'intern' } })[0].rows;
  assert.equal(rows.find((r) => r.key === 'track').value, 'Intern');
});
