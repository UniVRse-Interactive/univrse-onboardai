// Server-assigned Employee IDs and temporary passwords (issue #34): pg-mem
// running the real migrations, the in-memory Firestore fake and synthetic
// people only. No network, no Docker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startAccountsApp, syntheticProfile } from './account-harness.mjs';
import { createTestDatabase } from './test-database.mjs';
import { departments } from '../../server/departments.mjs';
import { migrationsDirectory } from '../../server/database-migrations.mjs';
import { formatEmployeeId, prefixPattern, reservedPrefix } from '../../server/employee-ids.mjs';
import { validateProfile } from '../../server/employee-profiles.mjs';
import {
  generatedPasswordPattern,
  generatePassword,
  passwordProblem,
} from '../../server/password-hashing.mjs';

async function withApp(options, check) {
  if (typeof options === 'function') [options, check] = [{}, options];
  const app = await startAccountsApp(options);
  try {
    await check(app);
  } finally {
    await app.close();
  }
}

const create = (hr, department, fullName = 'Avery Example') =>
  hr.post('/api/hr/employees', { profile: syntheticProfile(fullName, department) });
const idOf = (response) => {
  assert.equal(response.status, 201, response.text);
  return response.body.employee.account.username;
};
const counters = (app) =>
  app.rows('SELECT prefix, last_number FROM employee_id_counters ORDER BY prefix');
const employeeCount = async (app) =>
  (await app.rows("SELECT count(*)::int AS n FROM accounts WHERE role = 'employee'"))[0].n;
const problemsOf = (input, options) => {
  try {
    validateProfile(input, options);
  } catch (error) {
    assert.equal(error.code, 'PROFILE_INVALID');
    return error.details.fields;
  }
  return [];
};

test('the seed departments and prefix rules are fixed, and the seed module imports nothing', () => {
  assert.deepEqual(departments, [
    { name: 'Product & Engineering', prefix: 'PE' },
    { name: 'Customer Success', prefix: 'CS' },
    { name: 'Sales & Marketing', prefix: 'SM' },
    { name: 'Finance', prefix: 'FN' },
    { name: 'People & Culture', prefix: 'PC' },
    { name: 'Operations & Facilities', prefix: 'OF' },
  ]);
  assert.ok(Object.isFrozen(departments));
  // The browser imports this file too, so it must stay free of imports.
  const source = readFileSync(new URL('../../server/departments.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*import\b/m);
  assert.equal(reservedPrefix, 'HR');
  for (const good of ['PE', 'LEG', 'ABCD']) assert.match(good, prefixPattern);
  for (const bad of ['P', 'ABCDE', 'pe', 'P1', 'PE-', ' PE', 'PE\n'])
    assert.doesNotMatch(bad, prefixPattern, JSON.stringify(bad));
  assert.equal(formatEmployeeId('PE', 7), 'PE-0007');
  assert.equal(formatEmployeeId('PE', 9999), 'PE-9999');
  assert.equal(formatEmployeeId('PE', 10000), 'PE-10000');
});

test('each department gets its own prefix, numbered per prefix from 0001', async () => {
  await withApp(async (app) => {
    const hr = await app.hrBrowser();
    const ids = [];
    for (const { name } of departments) ids.push(idOf(await create(hr, name)));
    ids.push(idOf(await create(hr, 'Product & Engineering', 'Blake Sample')));
    assert.deepEqual(ids, [
      'PE-0001',
      'CS-0001',
      'SM-0001',
      'FN-0001',
      'PC-0001',
      'OF-0001',
      'PE-0002',
    ]);
    assert.deepEqual(await counters(app), [
      { prefix: 'CS', last_number: 1 },
      { prefix: 'FN', last_number: 1 },
      { prefix: 'OF', last_number: 1 },
      { prefix: 'PC', last_number: 1 },
      { prefix: 'PE', last_number: 2 },
      { prefix: 'SM', last_number: 1 },
    ]);
    // The profile keeps the department HR chose.
    const listed = (await hr.get('/api/hr/employees')).body.employees;
    assert.deepEqual(
      listed.map((entry) => [entry.account.username, entry.profile.department]),
      [
        ['CS-0001', 'Customer Success'],
        ['FN-0001', 'Finance'],
        ['OF-0001', 'Operations & Facilities'],
        ['PC-0001', 'People & Culture'],
        ['PE-0001', 'Product & Engineering'],
        ['PE-0002', 'Product & Engineering'],
        ['SM-0001', 'Sales & Marketing'],
      ],
    );
  });
});

test('the department is required and must be one of the six; a refused body uses no number', async () => {
  await withApp(async (app) => {
    const hr = await app.hrBrowser();
    const field = 'job.department';
    const cases = [
      [undefined, 'required'],
      ['', 'required'],
      ['   ', 'required'],
      [null, 'required'],
      ['Marketing', 'invalid_department'],
      ['finance', 'invalid_department'],
      ['People Operations', 'invalid_department'],
      ['Product & Engineering\nOps', 'invalid_department'],
      ['x'.repeat(200), 'invalid_department'],
      [42, 'not_text'],
    ];
    for (const [department, problem] of cases) {
      const profile = syntheticProfile();
      if (department === undefined) delete profile.job.department;
      else profile.job.department = department;
      const refused = await hr.post('/api/hr/employees', { profile });
      assert.equal(refused.status, 400, String(department));
      assert.equal(refused.body.code, 'PROFILE_INVALID');
      assert.deepEqual(refused.body.fields, [{ field, problem }], String(department));
    }
    // Every problem is reported together, the department's among them.
    const several = await hr.post('/api/hr/employees', {
      profile: { job: { fullName: '', department: 'Legal' }, contact: { workEmail: 'bad' } },
    });
    assert.deepEqual(several.body.fields, [
      { field: 'job.fullName', problem: 'required' },
      { field, problem: 'invalid_department' },
      { field: 'contact.workEmail', problem: 'invalid_email' },
    ]);
    assert.match(several.body.error, /job\.department must be one of the departments in the list/);
    assert.equal(await employeeCount(app), 0);
    assert.deepEqual(await counters(app), []);
    assert.deepEqual(app.firestore.paths('employeeProfiles/'), []);
    // Surrounding spaces are trimmed; the stored department is the exact name.
    const padded = await create(hr, '  Finance ');
    assert.equal(idOf(padded), 'FN-0001');
    assert.equal(padded.body.employee.profile.job.department, 'Finance');
  });
});

test('username and temporaryPassword are no longer accepted when creating an employee', async () => {
  await withApp(async (app) => {
    const hr = await app.hrBrowser();
    const profile = syntheticProfile();
    for (const body of [
      { username: 'PC-0001', profile },
      { temporaryPassword: 'temporary-pass-1', profile },
      { username: 'PC-0001', temporaryPassword: 'temporary-pass-1', profile },
      { profile, department: 'Finance' },
    ]) {
      const refused = await hr.post('/api/hr/employees', body);
      assert.equal(refused.status, 400);
      assert.deepEqual(refused.body, {
        code: 'EMPLOYEE_INVALID',
        error:
          'Send only the employee’s profile. The server assigns the Employee ID and the temporary password.',
      });
    }
    assert.equal(await employeeCount(app), 0);
    assert.deepEqual(await counters(app), []);
  });
});

test('the temporary password meets the rules, appears only in the 201 and in no log, row or document', async () => {
  const printed = [];
  const original = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    original[level] = console[level];
    console[level] = (...args) => printed.push(args.map(String).join(' '));
  }
  try {
    await withApp(async (app) => {
      const hr = await app.hrBrowser();
      const created = await create(hr, 'Product & Engineering');
      assert.equal(created.status, 201);
      assert.equal(created.headers.get('cache-control'), 'no-store');
      const { employee, temporaryPassword } = created.body;
      assert.equal(employee.account.username, 'PE-0001');
      assert.match(temporaryPassword, generatedPasswordPattern);
      assert.equal(passwordProblem(temporaryPassword, employee.account.username), null);
      // A forced change is still set.
      assert.equal(employee.account.mustChangePassword, true);
      const second = await create(hr, 'Product & Engineering', 'Blake Sample');
      assert.notEqual(second.body.temporaryPassword, temporaryPassword);

      // The password works once, then must be replaced.
      const staff = app.browser();
      const signed = await staff.signIn('PE-0001', temporaryPassword);
      assert.equal(signed.status, 200);
      assert.equal(signed.body.account.mustChangePassword, true);
      const blocked = await staff.get('/api/me/profile');
      assert.deepEqual([blocked.status, blocked.body.code], [403, 'PASSWORD_CHANGE_REQUIRED']);
      const changed = await staff.post('/api/auth/password', {
        currentPassword: temporaryPassword,
        newPassword: 'employee-own-pass-1',
      });
      assert.equal(changed.status, 200);
      assert.equal(changed.body.account.mustChangePassword, false);
      assert.equal((await staff.get('/api/me/profile')).status, 200);

      // It is never shown again, logged or stored as text.
      const read = await hr.get(`/api/hr/employees/${employee.account.id}`);
      const list = await hr.get('/api/hr/employees');
      const rows = [];
      for (const table of ['accounts', 'sessions', 'account_events', 'employee_id_counters'])
        rows.push(...(await app.rows(`SELECT * FROM ${table}`)));
      const documents = app.firestore.paths().map((path) => app.firestore.read(path));
      for (const [where, text] of [
        ['read', read.text],
        ['list', list.text],
        ['sign-in', signed.text],
        ['logs', app.logs.join('\n')],
        ['console', printed.join('\n')],
        ['database', JSON.stringify(rows)],
        ['firestore', JSON.stringify(documents)],
      ])
        for (const secret of [temporaryPassword, second.body.temporaryPassword])
          assert.ok(!text.includes(secret), `${where} must not contain the password`);
    });
  } finally {
    Object.assign(console, original);
  }
  // The generator itself: four groups of five, no look-alike characters.
  const picks = [0, 30];
  for (const pick of picks)
    assert.equal(
      generatePassword(() => pick),
      Array(4)
        .fill(pick ? '99999' : 'aaaaa')
        .join('-'),
    );
});

test('a counter starts after the highest existing username with its prefix, whatever its case or role', async () => {
  await withApp(async (app) => {
    const hr = await app.hrBrowser();
    await app.createHr('PE-0007', 'synthetic-hr-pass-7');
    const employee = (username) =>
      app.store.createAccount({
        username,
        passwordHash: 'scrypt$n=1024,r=8,p=1$synthetic$synthetic',
        role: 'employee',
        mustChangePassword: true,
        action: 'employee_created',
        at: app.clock.now(),
      });
    // Lower case counts; other shapes and other prefixes do not.
    for (const username of ['pe-0003', 'PE-1234567890', 'PE-X12', 'XPE-0050', 'PEX-0040'])
      await employee(username);
    assert.equal(idOf(await create(hr, 'Product & Engineering')), 'PE-0008');
    assert.equal(idOf(await create(hr, 'Customer Success')), 'CS-0001');
    // An account made later outside the counter is skipped over, not collided with.
    await employee('PE-0020');
    assert.equal(idOf(await create(hr, 'Product & Engineering')), 'PE-0021');
    assert.deepEqual(await counters(app), [
      { prefix: 'CS', last_number: 1 },
      { prefix: 'PE', last_number: 21 },
    ]);
  });
});

test('concurrent creates in one department get distinct, consecutive numbers', async () => {
  await withApp(async (app) => {
    const hr = await app.hrBrowser();
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) => create(hr, 'Product & Engineering', `Person ${i}`)),
    );
    assert.deepEqual(
      responses.map(idOf).sort(),
      Array.from({ length: 8 }, (_, i) => formatEmployeeId('PE', i + 1)),
    );
    // The store on its own, with no HTTP in between.
    const hrId = (await hr.get('/api/auth/session')).body.account.id;
    const rows = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.store.createEmployee({
          prefix: 'OF',
          passwordHash: 'scrypt$n=1024,r=8,p=1$synthetic$synthetic',
          createdBy: hrId,
          at: app.clock.now(),
        }),
      ),
    );
    assert.deepEqual(
      rows.map((row) => row.username).sort(),
      Array.from({ length: 10 }, (_, i) => formatEmployeeId('OF', i + 1)),
    );
    assert.ok(rows.every((row) => row.must_change_password && row.role === 'employee'));
  });
});

test('a deleted employee’s number is never handed out again', async () => {
  await withApp(async (app) => {
    const hr = await app.hrBrowser();
    const first = await create(hr, 'Finance');
    const second = await create(hr, 'Finance', 'Blake Sample');
    assert.deepEqual([idOf(first), idOf(second)], ['FN-0001', 'FN-0002']);
    const remove = (response) =>
      hr.delete(`/api/hr/employees/${response.body.employee.account.id}`);
    assert.equal((await remove(second)).status, 204);
    const third = await create(hr, 'Finance', 'Casey Example');
    assert.equal(idOf(third), 'FN-0003');
    // Even with no FN account left at all.
    for (const response of [first, third]) assert.equal((await remove(response)).status, 204);
    assert.equal(await employeeCount(app), 0);
    assert.equal(idOf(await create(hr, 'Finance', 'Drew Example')), 'FN-0004');
    assert.deepEqual(await counters(app), [{ prefix: 'FN', last_number: 4 }]);
  });
});

test('a failed creation leaves a gap: its number stays used unless the database itself failed', async () => {
  await withApp({ storageTimeoutMs: 100 }, async (app) => {
    const hr = await app.hrBrowser();
    const nothingKept = async () => {
      assert.equal(await employeeCount(app), 0);
      assert.deepEqual(app.firestore.paths('employeeProfiles/'), []);
      assert.deepEqual(
        await app.rows("SELECT id FROM account_events WHERE action = 'employee_created'"),
        [],
      );
    };
    // The Firestore profile write fails: the account is rolled back, PE-0001 stays used.
    app.firestore.fail(14, { only: ['set'] });
    const failed = await create(hr, 'Product & Engineering');
    assert.deepEqual([failed.status, failed.body.code], [503, 'PROFILE_STORAGE_UNAVAILABLE']);
    await nothingKept();
    assert.deepEqual(await counters(app), [{ prefix: 'PE', last_number: 1 }]);

    // The database fails while taking the number: nothing changes at all.
    app.database.fail('08006', { match: /employee_id_counters/ });
    const lost = await create(hr, 'Product & Engineering');
    assert.deepEqual([lost.status, lost.body.code], [503, 'ACCOUNTS_UNAVAILABLE']);
    assert.deepEqual(await counters(app), [{ prefix: 'PE', last_number: 1 }]);

    // The database fails on the account insert, after the number was taken.
    app.database.fail('08006', { match: /INSERT INTO accounts/ });
    const insert = await create(hr, 'Product & Engineering');
    assert.deepEqual([insert.status, insert.body.code], [503, 'ACCOUNTS_UNAVAILABLE']);
    await nothingKept();
    assert.deepEqual(await counters(app), [{ prefix: 'PE', last_number: 2 }]);

    // An ID that is somehow taken already (an account made outside the
    // counter at the same moment) is retried with the next number.
    app.database.fail('23505', { match: /INSERT INTO accounts/ });
    assert.equal(idOf(await create(hr, 'Product & Engineering')), 'PE-0004');
    // Three in a row give up with the database's 503.
    app.database.fail('23505', { match: /INSERT INTO accounts/, times: 3 });
    const taken = await create(hr, 'Product & Engineering', 'Blake Sample');
    assert.deepEqual([taken.status, taken.body.code], [503, 'ACCOUNTS_UNAVAILABLE']);
    assert.equal(idOf(await create(hr, 'Product & Engineering', 'Casey Example')), 'PE-0008');
    assert.deepEqual(
      (await hr.get('/api/hr/employees')).body.employees.map((entry) => entry.account.username),
      ['PE-0004', 'PE-0008'],
    );
    // Log lines name the operation and code only.
    assert.deepEqual(
      app.logs.filter((line) => line.startsWith('Account database request failed')),
      [
        'Account database request failed: {"operation":"create employee","code":"08006"}',
        'Account database request failed: {"operation":"create employee","code":"08006"}',
      ],
    );
  });
});

test('an employee’s stored free-text department stays editable; any other change must pick one of the six', async () => {
  await withApp(async (app) => {
    const hr = await app.hrBrowser();
    const { employee } = await app.createEmployee(hr);
    const id = employee.account.id;
    const path = `employeeProfiles/${id}`;
    // A profile saved before the list existed.
    const legacy = syntheticProfile('Avery Example', 'People Operations');
    app.firestore.write(path, { ...legacy, updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: id });
    const put = (department, fullName = 'Avery Q. Example') => {
      const profile = syntheticProfile(fullName, department);
      return hr.put(`/api/hr/employees/${id}/profile`, { profile });
    };
    const refused = async (department, problem) => {
      const response = await put(department);
      assert.equal(response.status, 400, String(department));
      assert.equal(response.body.code, 'PROFILE_INVALID');
      assert.deepEqual(response.body.fields, [{ field: 'job.department', problem }]);
    };
    const kept = await put('People Operations');
    assert.equal(kept.status, 200, kept.text);
    assert.equal(kept.body.employee.profile.job.fullName, 'Avery Q. Example');
    assert.equal(kept.body.employee.profile.job.department, 'People Operations');
    await refused('People Ops', 'invalid_department');
    await refused('', 'required');
    // Choosing a listed department replaces it; the Employee ID does not change.
    const moved = await put('Finance');
    assert.equal(moved.status, 200);
    assert.equal(moved.body.employee.account.username, 'PC-0001');
    assert.equal(app.firestore.read(path).job.department, 'Finance');
    await refused('People Operations', 'invalid_department');
    // A legacy profile without a department, or no profile at all, keeps '' allowed.
    app.firestore.write(path, { ...legacy, job: { ...legacy.job, department: '' } });
    assert.equal((await put('')).status, 200);
    await app.firestore.connect().collection('employeeProfiles').doc(id).delete();
    assert.equal((await put('')).status, 200);
    await refused('People Operations', 'invalid_department');
    // Unknown employees are still 404 when the department is valid.
    const unknown = await hr.put('/api/hr/employees/00000000-0000-4000-8000-000000000000/profile', {
      profile: syntheticProfile(),
    });
    assert.deepEqual([unknown.status, unknown.body.code], [404, 'EMPLOYEE_NOT_FOUND']);
  });
  // The rule itself.
  const profile = (department) => ({ job: { fullName: 'Avery', department } });
  const department = (problem) => [{ field: 'job.department', problem }];
  assert.deepEqual(problemsOf(profile('Legacy Team'), { keepDepartment: 'Legacy Team' }), []);
  assert.deepEqual(problemsOf(profile(' Legacy Team '), { keepDepartment: 'Legacy Team' }), []);
  assert.deepEqual(problemsOf(profile('Finance'), { keepDepartment: 'Legacy Team' }), []);
  assert.deepEqual(problemsOf(profile(''), { keepDepartment: '' }), []);
  assert.deepEqual(
    problemsOf(profile('Other'), { keepDepartment: 'Legacy Team' }),
    department('invalid_department'),
  );
  assert.deepEqual(problemsOf(profile(''), { keepDepartment: 'X' }), department('required'));
  assert.deepEqual(problemsOf(profile('')), department('required'));
  assert.deepEqual(problemsOf(profile('Legacy Team')), department('invalid_department'));
});

test('createEmployeeAccount is the one shared entry point for creating employees', async () => {
  await withApp(async (app) => {
    const hr = await app.hrBrowser();
    const hrId = (await hr.get('/api/auth/session')).body.account.id;
    const result = await app.accounts.createEmployeeAccount({
      profile: syntheticProfile('Imported Example', 'Operations & Facilities'),
      actorId: hrId,
    });
    assert.deepEqual(Object.keys(result).sort(), ['employee', 'temporaryPassword']);
    assert.deepEqual(Object.keys(result.employee), ['account', 'profile']);
    const { account, profile } = result.employee;
    assert.deepEqual(
      [account.username, account.role, account.mustChangePassword],
      ['OF-0001', 'employee', true],
    );
    assert.equal(profile.updatedBy, hrId);
    assert.equal(profile.job.department, 'Operations & Facilities');
    assert.equal(passwordProblem(result.temporaryPassword, account.username), null);
    // The same account HR's own route shows, created by that HR account.
    assert.deepEqual((await hr.get(`/api/hr/employees/${account.id}`)).body.employee, {
      account,
      profile,
    });
    assert.deepEqual(
      await app.rows(
        `SELECT actor_id FROM account_events WHERE action = 'employee_created' AND target_id = '${account.id}'`,
      ),
      [{ actor_id: hrId }],
    );
    const signed = await app.browser().signIn('OF-0001', result.temporaryPassword);
    assert.equal(signed.body.account.mustChangePassword, true);
    // The same rules as the route.
    await assert.rejects(
      app.accounts.createEmployeeAccount({
        profile: { job: { fullName: 'No Department' } },
        actorId: hrId,
      }),
      (error) =>
        error.code === 'PROFILE_INVALID' &&
        error.details.fields[0].field === 'job.department' &&
        error.details.fields[0].problem === 'required',
    );
    await assert.rejects(
      app.accounts.createEmployeeAccount({ profile: syntheticProfile() }),
      TypeError,
    );
    assert.equal(await employeeCount(app), 1);
  });
});

// pg-mem cannot run CREATE TABLE IF NOT EXISTS over an existing table with
// constraints, so running the file twice is checked on the real PostgreSQL in
// the live run; here the guard is checked in the text.
test('migration 003 is guarded for a second run and holds only positive numbers per prefix', async () => {
  const database = await createTestDatabase();
  const sql = readFileSync(join(migrationsDirectory, '003_employee_id_counters.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS employee_id_counters \(/);
  assert.doesNotMatch(sql, /\b(DROP|DELETE|UPDATE|ALTER)\b/i);
  assert.ok(database.migrated.applied.includes('003_employee_id_counters.sql'));
  const insert = (prefix, number) =>
    database.pool.query('INSERT INTO employee_id_counters (prefix, last_number) VALUES ($1, $2)', [
      prefix,
      number,
    ]);
  await insert('PE', 1);
  // Migration 004 relaxed the two-letter rule to two to four letters.
  await insert('PEX', 1);
  for (const [prefix, number] of [
    ['pe', 1],
    ['PEXTR', 1],
    ['P', 1],
    ['P1', 1],
    ['CS', 0],
  ])
    await assert.rejects(insert(prefix, number), `${prefix} ${number}`);
  await assert.rejects(insert('PE', 2)); // one row per prefix
});
