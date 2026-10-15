import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProfileStore,
  presentProfile,
  profileSchema,
  profileSummary,
  validateProfile,
} from '../../server/employee-profiles.mjs';
import { FakeFirestore } from './fake-firestore.mjs';
import { syntheticProfile } from './account-harness.mjs';

const problems = (input) => {
  try {
    validateProfile(input);
  } catch (error) {
    assert.equal(error.status, 400);
    assert.equal(error.code, 'PROFILE_INVALID');
    return error.details.fields;
  }
  assert.fail('expected PROFILE_INVALID');
};

test('a complete profile is trimmed and stored with every field present', () => {
  const input = syntheticProfile();
  input.job.fullName = '  Avery Example  ';
  const profile = validateProfile(input);
  assert.equal(profile.job.fullName, 'Avery Example');
  assert.deepEqual(Object.keys(profile), ['job', 'contact', 'emergencyContact', 'homeAddress']);
  for (const [group, fields] of Object.entries(profileSchema))
    assert.deepEqual(Object.keys(profile[group]), Object.keys(fields));
  // Only the full name is required; missing groups and nulls become ''.
  const minimal = validateProfile({ job: { fullName: 'Sam Sample', manager: null } });
  assert.equal(minimal.job.manager, '');
  assert.equal(minimal.contact.workEmail, '');
  assert.equal(minimal.homeAddress.country, '');
  // Server-set fields from a previous read are accepted and ignored.
  const echoed = validateProfile({ ...input, updatedAt: 'x', updatedBy: 'y' });
  assert.equal(echoed.updatedAt, undefined);
  assert.equal(echoed.updatedBy, undefined);
});

test('unknown fields, wrong types and invalid values are rejected with their paths', () => {
  assert.deepEqual(problems(null), [{ field: 'profile', problem: 'not_object' }]);
  assert.deepEqual(problems([]), [{ field: 'profile', problem: 'not_object' }]);
  assert.deepEqual(problems({ job: {} }), [{ field: 'job.fullName', problem: 'required' }]);
  assert.deepEqual(problems({ job: { fullName: '   ' } }), [
    { field: 'job.fullName', problem: 'required' },
  ]);
  const base = syntheticProfile();
  assert.deepEqual(problems({ ...base, salary: '1' }), [{ field: 'salary', problem: 'unknown' }]);
  assert.deepEqual(problems({ ...base, job: { ...base.job, nationalId: 'S0000000A' } }), [
    { field: 'job.nationalId', problem: 'unknown' },
  ]);
  assert.deepEqual(problems({ ...base, contact: 'avery@example.com' }), [
    { field: 'contact', problem: 'not_object' },
  ]);
  const cases = [
    [{ job: { ...base.job, fullName: 'x'.repeat(121) } }, 'job.fullName', 'too_long'],
    [{ job: { ...base.job, startDate: '2026-02-30' } }, 'job.startDate', 'invalid_date'],
    [{ job: { ...base.job, startDate: '02/11/2026' } }, 'job.startDate', 'invalid_date'],
    [{ job: { ...base.job, department: 42 } }, 'job.department', 'not_text'],
    [{ job: { ...base.job, manager: 'Line\nbreak' } }, 'job.manager', 'invalid_characters'],
    [{ contact: { workEmail: 'not-an-email' } }, 'contact.workEmail', 'invalid_email'],
    [{ contact: { personalEmail: 'a@b' } }, 'contact.personalEmail', 'invalid_email'],
    [{ contact: { mobileNumber: 'call me' } }, 'contact.mobileNumber', 'invalid_phone'],
    [
      { emergencyContact: { phoneNumber: '1'.repeat(33) } },
      'emergencyContact.phoneNumber',
      'too_long',
    ],
    [{ homeAddress: { postcode: '1'.repeat(21) } }, 'homeAddress.postcode', 'too_long'],
  ];
  for (const [change, field, problem] of cases)
    assert.deepEqual(problems({ ...base, ...change }), [{ field, problem }], field);
  // Several problems are all reported; the message names fields, never values.
  try {
    validateProfile({
      job: { fullName: '' },
      contact: { workEmail: 'private-value' },
      extra: 'secret-extra',
    });
  } catch (error) {
    assert.equal(error.details.fields.length, 3);
    assert.match(error.message, /job\.fullName is required/);
    assert.ok(!error.message.includes('private-value') && !error.message.includes('secret-extra'));
  }
});

test('stored profiles are read back with every field, and the list summary leaves out private details', async () => {
  const fake = new FakeFirestore();
  const store = createProfileStore({ firestore: fake, log: () => {} });
  const at = new Date('2026-10-15T02:00:00.000Z');
  const written = await store.write('acc-1', validateProfile(syntheticProfile()), 'hr-1', at);
  assert.equal(written.updatedAt, '2026-10-15T02:00:00.000Z');
  assert.equal(written.updatedBy, 'hr-1');
  assert.deepEqual(fake.paths(), ['employeeProfiles/acc-1']);
  assert.deepEqual(await store.read('acc-1'), written);
  assert.equal(await store.read('acc-2'), null);
  const many = await store.readMany(['acc-1', 'acc-2']);
  assert.deepEqual([...many.keys()], ['acc-1']);
  assert.deepEqual(profileSummary(written), {
    fullName: 'Avery Example',
    preferredName: 'Avery',
    jobTitle: 'Onboarding Analyst',
    department: 'People Operations',
    startDate: '2026-11-02',
  });
  // A document missing newer fields still reads with every field present.
  fake.write('employeeProfiles/acc-3', { job: { fullName: 'Old Record' } });
  const old = await store.read('acc-3');
  assert.equal(old.contact.workEmail, '');
  assert.equal(old.updatedAt, null);
  assert.deepEqual(presentProfile(undefined).job.fullName, '');
  await store.remove('acc-1');
  assert.equal(await store.read('acc-1'), null);
});

test('profile storage failures are fixed messages, and logs never contain profile values', async () => {
  const fake = new FakeFirestore(),
    logs = [];
  const store = createProfileStore({
    firestore: fake,
    log: (line) => logs.push(line),
    timeoutMs: 50,
  });
  const profile = validateProfile(syntheticProfile('PRIVATE-NAME Example'));
  fake.fail(7, { only: ['set'] });
  await assert.rejects(store.write('acc-1', profile, 'hr-1', new Date()), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.code, 'PROFILE_STORAGE_UNAVAILABLE');
    return true;
  });
  fake.fail(0, { only: ['get'], hang: true });
  await assert.rejects(store.read('acc-1'), (error) => error.code === 'PROFILE_STORAGE_TIMEOUT');
  assert.equal(logs.length, 2);
  for (const line of logs) {
    assert.match(
      line,
      /^Firestore request failed: \{"operation":"[a-z ]+","code":"STORAGE_[A-Z_]+"/,
    );
    assert.ok(!line.includes('PRIVATE') && !line.includes('acc-1'));
  }
});
