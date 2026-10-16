import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autofillErrorMessage,
  autofillMaxBytes,
  autofillSummary,
  checkAutofillFile,
  clearFieldMarks,
  droppedLabels,
  emptyAutofillState,
  markFilled,
  mergeAutofill,
  warningNotes,
} from '../../src/access/profile-autofill.mjs';
import { profileToForm } from '../../src/access/profile-validation.mjs';

const result = (patch = {}) => ({
  profile: {
    ...profileToForm(null),
    job: { ...profileToForm(null).job, fullName: 'Ada Lovelace', jobTitle: 'Engineer' },
    contact: { ...profileToForm(null).contact, workEmail: 'ada@example.com' },
    ...patch,
  },
  filled: ['job.fullName', 'job.jobTitle', 'contact.workEmail'],
  warnings: [],
});

test('client check accepts supported types and rejects others and big or empty files', () => {
  for (const name of ['a.pdf', 'A.DOCX', 'n.txt', 'n.md', 'p.jpg', 'p.JPEG', 'p.png'])
    assert.equal(checkAutofillFile({ name, size: 100 }), null, name);
  assert.match(checkAutofillFile({ name: 'a.exe', size: 100 }), /not supported/);
  assert.match(checkAutofillFile({ name: 'noext', size: 100 }), /not supported/);
  assert.match(checkAutofillFile({ name: 'a.pdf', size: 0 }), /empty/);
  assert.equal(checkAutofillFile({ name: 'a.pdf', size: autofillMaxBytes }), null);
  assert.match(checkAutofillFile({ name: 'a.pdf', size: autofillMaxBytes + 1 }), /5 MB/);
  assert.ok(checkAutofillFile(null));
});

test('merge fills only empty fields and reports filled and skipped', () => {
  const form = profileToForm(null);
  form.job.fullName = 'Typed Name';
  const merged = mergeAutofill(form, result());
  assert.equal(merged.form.job.fullName, 'Typed Name');
  assert.equal(merged.form.job.jobTitle, 'Engineer');
  assert.equal(merged.form.contact.workEmail, 'ada@example.com');
  assert.deepEqual(merged.filled, ['job.jobTitle', 'contact.workEmail']);
  assert.deepEqual(merged.skipped, ['job.fullName']);
  assert.equal(form.job.jobTitle, '', 'input form is not mutated');
});

test('merge never adds an ID or password and ignores unknown fields', () => {
  const merged = mergeAutofill(profileToForm(null), {
    profile: { username: 'X', temporaryPassword: 'p', job: { fullName: 'A', password: 'p' } },
    filled: ['username', 'temporaryPassword', 'job.fullName', 'job.password'],
  });
  assert.deepEqual(Object.keys(merged.form).sort(), [
    'contact',
    'emergencyContact',
    'homeAddress',
    'job',
  ]);
  assert.ok(!('password' in merged.form.job));
  assert.deepEqual(merged.filled, ['job.fullName']);
});

test('whitespace-only document values and typed whitespace count as empty', () => {
  const form = profileToForm(null);
  form.job.jobTitle = '   ';
  const merged = mergeAutofill(form, result({ job: { fullName: '  ', jobTitle: 'Dev' } }));
  assert.deepEqual(merged.filled, ['job.jobTitle', 'contact.workEmail']);
});

test('warnings map to field paths with a readable note', () => {
  const form = profileToForm(null);
  const notes = warningNotes(
    [
      { field: 'contact.workEmail', problem: 'invalid_email' },
      { field: 'job.startDate', problem: 'invalid_date' },
      { field: 'nope.field', problem: 'too_long' },
    ],
    form,
  );
  assert.deepEqual(Object.keys(notes), ['contact.workEmail', 'job.startDate']);
  assert.equal(
    notes['contact.workEmail'],
    "The document's work email wasn't valid, so it was left empty.",
  );
  form.job.startDate = '2024-01-01';
  assert.ok(
    !('job.startDate' in warningNotes([{ field: 'job.startDate', problem: 'invalid_date' }], form)),
  );
  assert.deepEqual(warningNotes(undefined, form), {});
});

test('editing a field clears its mark and note only', () => {
  let state = markFilled(emptyAutofillState(), ['job.fullName', 'job.jobTitle'], {
    'contact.workEmail': 'note',
  });
  assert.deepEqual(Object.keys(state.marks), ['job.fullName', 'job.jobTitle']);
  state = clearFieldMarks(state, 'job.fullName');
  assert.deepEqual(Object.keys(state.marks), ['job.jobTitle']);
  state = clearFieldMarks(state, 'contact.workEmail');
  assert.deepEqual(state.notes, {});
  assert.equal(clearFieldMarks(state, 'job.manager'), state);
});

test('summary counts fields and mentions skipped ones', () => {
  assert.equal(
    autofillSummary({ filled: ['a', 'b'], skipped: [], fileName: 'cv.pdf' }),
    'Filled 2 fields from cv.pdf. Check them before saving.',
  );
  assert.match(
    autofillSummary({ filled: ['a'], skipped: ['b', 'c'], fileName: 'cv.pdf' }),
    /^Filled 1 field from cv\.pdf\. Check them before saving\. Skipped 2 fields/,
  );
  assert.match(autofillSummary({ filled: [], skipped: ['b'], fileName: 'x.md' }), /Nothing new/);
});

test('error codes map to messages', () => {
  assert.match(
    autofillErrorMessage({ code: 'AUTOFILL_UNAVAILABLE', message: 'x' }),
    /couldn't read/,
  );
  assert.equal(
    autofillErrorMessage({ code: 'AUTOFILL_NOTHING_FOUND', message: 'No profile details found.' }),
    'No profile details found.',
  );
  assert.equal(
    autofillErrorMessage({ code: 'AUTOFILL_FILE_TOO_LARGE', message: 'Too big.' }),
    'Too big.',
  );
  assert.match(autofillErrorMessage({}), /couldn't read/);
});

test('filled counts only the server filled list that was also filled here', () => {
  const merged = mergeAutofill(profileToForm(null), {
    ...result(),
    filled: ['job.fullName', 'job.manager'],
  });
  assert.deepEqual(merged.filled, ['job.fullName']);
  assert.equal(merged.form.job.jobTitle, '', 'not in the server list, so not filled');
});

test('warnings on fields HR already filled go in the summary', () => {
  const form = profileToForm(null);
  form.contact.personalEmail = 'me@example.com';
  const warnings = [
    { field: 'contact.personalEmail', problem: 'invalid_email' },
    { field: 'job.startDate', problem: 'invalid_date' },
  ];
  assert.deepEqual(droppedLabels(warnings, form), ['Personal email']);
  assert.equal(
    autofillSummary({
      filled: ['a'],
      skipped: [],
      fileName: 'cv.pdf',
      dropped: ['Personal email'],
    }),
    "Filled 1 field from cv.pdf. Check them before saving. 1 value in the document wasn't valid and was left out: Personal email.",
  );
});
