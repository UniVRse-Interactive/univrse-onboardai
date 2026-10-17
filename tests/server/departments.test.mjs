// HR Settings departments (issue #36): pg-mem running the real migrations, the
// in-memory Firestore fake and synthetic people only. No network, no Docker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startAccountsApp, syntheticProfile } from './account-harness.mjs';
import { createTestDatabase } from './test-database.mjs';
import { departments as seeds } from '../../server/departments.mjs';
import { migrate, migrationsDirectory } from '../../server/database-migrations.mjs';
import { validateProfile } from '../../server/employee-profiles.mjs';
import { autofillRequest } from '../../server/profile-autofill.mjs';

async function withApp(options, check) {
  if (typeof options === 'function') [options, check] = [{}, options];
  const app = await startAccountsApp(options);
  try {
    await check(app);
  } finally {
    await app.close();
  }
}

const list = async (hr) => {
  const response = await hr.get('/api/hr/departments');
  assert.equal(response.status, 200, response.text);
  return response.body.departments;
};
const add = (hr, name, prefix) => hr.post('/api/hr/departments', { name, prefix });
const patch = (hr, id, body) => hr.request('PATCH', `/api/hr/departments/${id}`, body);
const named = async (hr, name) => (await list(hr)).find((department) => department.name === name);
const create = (hr, department, fullName = 'Avery Example') =>
  hr.post('/api/hr/employees', { profile: syntheticProfile(fullName, department) });
const idOf = (response) => {
  assert.equal(response.status, 201, response.text);
  return response.body.employee.account.username;
};
const counters = (app) =>
  app.rows('SELECT prefix, last_number FROM employee_id_counters ORDER BY prefix');
const events = (app) =>
  app.rows(
    "SELECT action, actor_id, target_id, detail FROM account_events WHERE action LIKE 'department_%' ORDER BY id",
  );
const problems = (response) => response.body.fields;
const profileOf = (app, id) => app.firestore.read(`employeeProfiles/${id}`);

test('migration 004 seeds the six departments, keeps them on a second run and relaxes the prefix rule', async () => {
  const database = await createTestDatabase();
  assert.ok(database.migrated.applied.includes('004_departments.sql'));
  const rows = () =>
    database.rows('SELECT name, prefix, archived FROM departments ORDER BY prefix');
  const seeded = await rows();
  assert.deepEqual(
    seeded,
    seeds
      .map(({ name, prefix }) => ({ name, prefix, archived: false }))
      .sort((a, b) => (a.prefix < b.prefix ? -1 : 1)),
  );
  // The runner skips it on a rerun, and the file itself is guarded too.
  assert.deepEqual((await migrate(database.pool)).applied, []);
  const sql = readFileSync(join(migrationsDirectory, '004_departments.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS departments/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS departments_name_lower_key/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS departments_prefix_key/);
  assert.match(sql, /ON CONFLICT DO NOTHING/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS detail jsonb/);
  assert.doesNotMatch(sql, /\b(DELETE|TRUNCATE|DROP TABLE|UPDATE)\b/i);
  // The statements that pg-mem can repeat do not duplicate or reset anything.
  await database.pool.query(
    "INSERT INTO departments (name, prefix) VALUES ('Finance', 'ZZ') ON CONFLICT DO NOTHING",
  );
  await database.pool.query("UPDATE departments SET archived = true WHERE prefix = 'FN'");
  await database.pool.query(
    sql.slice(sql.indexOf('INSERT INTO departments'), sql.indexOf('-- Prefixes can be')),
  );
  assert.deepEqual((await rows()).length, 6);
  assert.equal((await rows()).find((row) => row.prefix === 'FN').archived, true);

  // The database holds the rules too: prefix shape, HR, name length, uniqueness.
  const insert = (name, prefix) =>
    database.pool.query('INSERT INTO departments (name, prefix) VALUES ($1, $2)', [name, prefix]);
  await insert('Legal', 'LG');
  await insert('Research', 'RSCH');
  for (const [name, prefix] of [
    ['A', 'P'],
    ['B', 'ABCDE'],
    ['C', 'lg'],
    ['D', 'HR'],
    ['', 'DD'],
    ['x'.repeat(61), 'EE'],
    ['legal', 'LL'],
    ['Other', 'LG'],
  ])
    await assert.rejects(insert(name, prefix), `${name} ${prefix}`);
  // Counters take 2 to 4 letters now.
  const counter = (prefix) =>
    database.pool.query('INSERT INTO employee_id_counters (prefix, last_number) VALUES ($1, 1)', [
      prefix,
    ]);
  await counter('LEG');
  await counter('RSCH');
  await assert.rejects(counter('LEGAL'));
  await assert.rejects(counter('L'));
});

test('GET lists the seeded departments, active first then by name, with an example ID and employee counts', async () => {
  await withApp(async (app) => {
    const hr = await app.hrBrowser();
    await create(hr, 'Finance');
    await create(hr, 'Finance', 'Blake Sample');
    await create(hr, 'Customer Success');
    const response = await hr.get('/api/hr/departments');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(
      response.body.departments.map(({ id, ...rest }) => {
        assert.match(id, /^[0-9a-f-]{36}$/);
        return rest;
      }),
      [
        {
          name: 'Customer Success',
          prefix: 'CS',
          archived: false,
          exampleId: 'CS-0001',
          employees: 1,
        },
        { name: 'Finance', prefix: 'FN', archived: false, exampleId: 'FN-0001', employees: 2 },
        {
          name: 'Operations & Facilities',
          prefix: 'OF',
          archived: false,
          exampleId: 'OF-0001',
          employees: 0,
        },
        {
          name: 'People & Culture',
          prefix: 'PC',
          archived: false,
          exampleId: 'PC-0001',
          employees: 0,
        },
        {
          name: 'Product & Engineering',
          prefix: 'PE',
          archived: false,
          exampleId: 'PE-0001',
          employees: 0,
        },
        {
          name: 'Sales & Marketing',
          prefix: 'SM',
          archived: false,
          exampleId: 'SM-0001',
          employees: 0,
        },
      ],
    );
    // Archived ones move to the end.
    const finance = await named(hr, 'Finance');
    await patch(hr, finance.id, { archived: true });
    const after = await list(hr);
    assert.deepEqual(after.map((d) => d.name).at(-1), 'Finance');
    assert.equal(after.at(-1).archived, true);
    assert.equal(after.at(-1).employees, 2);
    // A Firestore failure while counting is the profile storage 503.
    app.firestore.fail(14, { only: ['query'] });
    const down = await hr.get('/api/hr/departments');
    assert.deepEqual([down.status, down.body.code], [503, 'PROFILE_STORAGE_UNAVAILABLE']);
  });
});

test('adding a department checks name and prefix, and the new department is usable at once', async () => {
  await withApp(async (app) => {
    const hr = await app.hrBrowser();
    const created = await add(hr, '  Legal ', 'LG');
    assert.equal(created.status, 201, created.text);
    assert.equal(created.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Object.keys(created.body), ['department']);
    const { id, ...rest } = created.body.department;
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(rest, {
      name: 'Legal',
      prefix: 'LG',
      archived: false,
      exampleId: 'LG-0001',
      employees: 0,
    });
    assert.equal((await list(hr)).length, 7);

    // Immediately a choice for a new hire: LG-0001, then LG-0002.
    const first = await create(hr, 'Legal');
    assert.equal(idOf(first), 'LG-0001');
    assert.equal(first.body.employee.profile.job.department, 'Legal');
    assert.equal(idOf(await create(hr, 'Legal', 'Blake Sample')), 'LG-0002');
    assert.equal((await named(hr, 'Legal')).employees, 2);
    assert.deepEqual(await counters(app), [{ prefix: 'LG', last_number: 2 }]);

    // ...and in the autofill enum, which is read for each request.
    const request = autofillRequest({ text: 'x' }, ['Legal']);
    assert.deepEqual(
      request.generationConfig.responseSchema.properties.job.properties.department.enum,
      ['Legal'],
    );
    assert.deepEqual(await app.accounts.activeDepartmentNames(), [
      'Customer Success',
      'Finance',
      'Legal',
      'Operations & Facilities',
      'People & Culture',
      'Product & Engineering',
      'Sales & Marketing',
    ]);

    // Three and four letter prefixes work for IDs.
    assert.equal((await add(hr, 'Research', 'RSCH')).status, 201);
    assert.equal((await add(hr, 'Data', 'DAT')).status, 201);
    assert.equal(idOf(await create(hr, 'Research')), 'RSCH-0001');
    assert.equal(idOf(await create(hr, 'Data')), 'DAT-0001');
    assert.equal(idOf(await create(hr, 'Data', 'Blake Sample')), 'DAT-0002');
  });
});

test('adding a department refuses bad names and prefixes with the fields at fault', async () => {
  await withApp(async (app) => {
    const hr = await app.hrBrowser();
    const refused = async (body, expected, status = 400, code = 'DEPARTMENT_INVALID') => {
      const response = await hr.post('/api/hr/departments', body);
      assert.equal(response.status, status, JSON.stringify(body));
      assert.equal(response.body.code, code);
      if (expected) assert.deepEqual(problems(response), expected, JSON.stringify(body));
      return response;
    };
    const field = (name, problem) => ({ field: name, problem });
    await refused({}, [field('name', 'required'), field('prefix', 'required')]);
    await refused({ name: '  ', prefix: '' }, [
      field('name', 'required'),
      field('prefix', 'required'),
    ]);
    await refused({ name: null, prefix: null }, [
      field('name', 'required'),
      field('prefix', 'required'),
    ]);
    await refused({ name: 'x'.repeat(61), prefix: 'XX' }, [field('name', 'too_long')]);
    await refused({ name: 'Two\nLines', prefix: 'XX' }, [field('name', 'invalid_format')]);
    await refused({ name: 'Tab\there', prefix: 'XX' }, [field('name', 'invalid_format')]);
    await refused({ name: 42, prefix: 'XX' }, [field('name', 'invalid_format')]);
    for (const prefix of ['P', 'ABCDE', 'lg', 'L1', 'L-G', 'LÉ', 'L G', 42])
      await refused({ name: 'Legal', prefix }, [field('prefix', 'invalid_format')]);
    await refused({ name: 'Legal', prefix: 'HR' }, [field('prefix', 'reserved')]);
    await refused({ name: 'Legal', prefix: ' HR ' }, [field('prefix', 'reserved')]);
    // HR may be part of a longer prefix.
    assert.equal((await add(hr, 'Hardware', 'HRD')).status, 201);
    // Unknown keys and a non-object body.
    await refused({ name: 'Legal', prefix: 'LG', archived: true });
    await refused({ name: 'Legal', prefix: 'LG', id: 'x' });
    await refused([]);
    assert.equal((await hr.post('/api/hr/departments', 'text')).status, 400);
    // A name of exactly 60 characters is fine.
    assert.equal((await add(hr, 'y'.repeat(60), 'YY')).status, 201);
  });
});

test('adding a department refuses a taken name or prefix, archived ones included', async () => {
  await withApp(async (app) => {
    const hr = await app.hrBrowser();
    const refused = async (body, status, code) => {
      const response = await hr.post('/api/hr/departments', body);
      assert.deepEqual([response.status, response.body.code], [status, code], JSON.stringify(body));
      return response;
    };
    // Taken name (any letter case, archived too) or prefix.
    const name = await refused({ name: 'finance', prefix: 'ZZ' }, 409, 'DEPARTMENT_NAME_TAKEN');
    assert.equal(
      name.body.error,
      'A department with that name already exists. Choose a different name.',
    );
    await refused({ name: ' FINANCE ', prefix: 'ZZ' }, 409, 'DEPARTMENT_NAME_TAKEN');
    await refused({ name: 'Legal', prefix: 'FN' }, 409, 'DEPARTMENT_PREFIX_TAKEN');
    const finance = await named(hr, 'Finance');
    await patch(hr, finance.id, { archived: true });
    await refused({ name: 'Finance', prefix: 'ZZ' }, 409, 'DEPARTMENT_NAME_TAKEN');
    await refused({ name: 'Money', prefix: 'FN' }, 409, 'DEPARTMENT_PREFIX_TAKEN');
    // Both taken: the name is reported first.
    await refused({ name: 'Finance', prefix: 'PE' }, 409, 'DEPARTMENT_NAME_TAKEN');
    // Nothing was added by any refusal, and no event beyond the two good adds.
    assert.equal((await list(hr)).length, 6);
    assert.equal((await events(app)).filter((e) => e.action === 'department_created').length, 0);

    // A database failure is the fixed 503 and adds nothing.
    app.database.fail('08006', { match: /INSERT INTO departments/ });
    const lost = await add(hr, 'Legal', 'LG');
    assert.deepEqual([lost.status, lost.body.code], [503, 'ACCOUNTS_UNAVAILABLE']);
    assert.equal(await named(hr, 'Legal'), undefined);
    // A race past the check ends in the unique index and the same 409.
    app.database.fail('23505', { match: /INSERT INTO departments/ });
    assert.equal((await add(hr, 'Legal', 'LG')).body.code, 'DEPARTMENT_NAME_TAKEN');
  });
});

test('a prefix change affects new IDs only; the old IDs and counters stay', async () => {
  await withApp(async (app) => {
    const hr = await app.hrBrowser();
    const legal = (await add(hr, 'Legal', 'LG')).body.department;
    assert.equal(idOf(await create(hr, 'Legal')), 'LG-0001');
    assert.equal(idOf(await create(hr, 'Legal', 'Blake Sample')), 'LG-0002');

    const changed = await patch(hr, legal.id, { prefix: 'LEG' });
    assert.equal(changed.status, 200, changed.text);
    assert.deepEqual(changed.body, {
      department: { ...legal, prefix: 'LEG', exampleId: 'LEG-0001', employees: 2 },
      updatedProfiles: 0,
    });
    const next = await create(hr, 'Legal', 'Casey Example');
    assert.equal(idOf(next), 'LEG-0001');
    // Existing usernames never change; the old counter is kept.
    assert.deepEqual(
      (await hr.get('/api/hr/employees')).body.employees.map((e) => e.account.username),
      ['LEG-0001', 'LG-0001', 'LG-0002'],
    );
    assert.deepEqual(await counters(app), [
      { prefix: 'LEG', last_number: 1 },
      { prefix: 'LG', last_number: 2 },
    ]);
    // The old prefix is free for another department, continuing its numbers.
    const other = (await add(hr, 'Logistics', 'LG')).body.department;
    assert.equal(other.prefix, 'LG');
    assert.equal(idOf(await create(hr, 'Logistics')), 'LG-0003');
    // A new prefix starts after the highest existing username that has it.
    await app.createHr('MOV-0009', 'synthetic-hr-pass-9');
    const moved = await patch(hr, other.id, { prefix: 'MOV' });
    assert.equal(moved.status, 200);
    assert.equal(idOf(await create(hr, 'Logistics', 'Drew Example')), 'MOV-0010');

    // Prefix rules and uniqueness apply to edits too.
    const rule = async (body, status, code, fields) => {
      const response = await patch(hr, legal.id, body);
      assert.deepEqual([response.status, response.body.code], [status, code], JSON.stringify(body));
      if (fields) assert.deepEqual(problems(response), fields);
    };
    await rule({ prefix: 'HR' }, 400, 'DEPARTMENT_INVALID', [
      { field: 'prefix', problem: 'reserved' },
    ]);
    await rule({ prefix: 'L' }, 400, 'DEPARTMENT_INVALID', [
      { field: 'prefix', problem: 'invalid_format' },
    ]);
    await rule({ prefix: 'abc' }, 400, 'DEPARTMENT_INVALID', [
      { field: 'prefix', problem: 'invalid_format' },
    ]);
    await rule({ prefix: '' }, 400, 'DEPARTMENT_INVALID', [
      { field: 'prefix', problem: 'required' },
    ]);
    await rule({ prefix: 'FN' }, 409, 'DEPARTMENT_PREFIX_TAKEN');
    assert.equal((await named(hr, 'Legal')).prefix, 'LEG');
    // Saving the same prefix again changes nothing and records nothing.
    const before = (await events(app)).length;
    assert.equal((await patch(hr, legal.id, { prefix: 'LEG' })).status, 200);
    assert.equal((await events(app)).length, before);
  });
});

test('a rename updates every profile with the old name, in the same step', async () => {
  await withApp(async (app) => {
    const hr = await app.hrBrowser();
    const finance = await named(hr, 'Finance');
    const a = await app.createEmployee(hr, syntheticProfile('Avery Example', 'Finance'));
    const b = await app.createEmployee(hr, syntheticProfile('Blake Sample', 'Finance'));
    const c = await app.createEmployee(hr, syntheticProfile('Casey Example', 'Customer Success'));
    const idA = a.employee.account.id;
    const profileBefore = profileOf(app, idA);

    const renamed = await patch(hr, finance.id, { name: '  Finance & Accounting ' });
    assert.equal(renamed.status, 200, renamed.text);
    assert.deepEqual(renamed.body, {
      department: { ...finance, name: 'Finance & Accounting', employees: 2 },
      updatedProfiles: 2,
    });
    assert.equal(profileOf(app, idA).job.department, 'Finance & Accounting');
    assert.equal(profileOf(app, b.employee.account.id).job.department, 'Finance & Accounting');
    assert.equal(profileOf(app, c.employee.account.id).job.department, 'Customer Success');
    // Only the department changed on the profile; usernames and the prefix too.
    assert.deepEqual(
      { ...profileOf(app, idA), job: { ...profileOf(app, idA).job, department: 'Finance' } },
      profileBefore,
    );
    assert.equal(a.employee.account.username, 'FN-0001');
    const listed = (await hr.get('/api/hr/employees')).body.employees;
    assert.deepEqual(
      listed.map((e) => [e.account.username, e.profile.department]),
      [
        ['CS-0001', 'Customer Success'],
        ['FN-0001', 'Finance & Accounting'],
        ['FN-0002', 'Finance & Accounting'],
      ],
    );
    // The new name is the choice for a new hire; the old name no longer is.
    assert.equal(idOf(await create(hr, 'Finance & Accounting', 'Drew Example')), 'FN-0003');
    const old = await create(hr, 'Finance');
    assert.deepEqual(problems(old), [{ field: 'job.department', problem: 'invalid_department' }]);

    // Names stay unique (any letter case), and are validated like new ones.
    const name = async (body, status, code, fields) => {
      const response = await patch(hr, finance.id, body);
      assert.deepEqual([response.status, response.body.code], [status, code], JSON.stringify(body));
      if (fields) assert.deepEqual(problems(response), fields);
    };
    await name({ name: 'customer success' }, 409, 'DEPARTMENT_NAME_TAKEN');
    await name({ name: '' }, 400, 'DEPARTMENT_INVALID', [{ field: 'name', problem: 'required' }]);
    await name({ name: 'x'.repeat(61) }, 400, 'DEPARTMENT_INVALID', [
      { field: 'name', problem: 'too_long' },
    ]);
    await name({ name: 'a\nb' }, 400, 'DEPARTMENT_INVALID', [
      { field: 'name', problem: 'invalid_format' },
    ]);
    // Changing only the letter case is a rename too.
    const recased = await patch(hr, finance.id, { name: 'FINANCE & ACCOUNTING' });
    assert.equal(recased.status, 200);
    assert.equal(recased.body.updatedProfiles, 3);
    assert.equal(profileOf(app, idA).job.department, 'FINANCE & ACCOUNTING');
  });
});

test('a rename that cannot update the profiles changes nothing, and a retry works', async () => {
  await withApp(async (app) => {
    const hr = await app.hrBrowser();
    const finance = await named(hr, 'Finance');
    const a = await app.createEmployee(hr, syntheticProfile('Avery Example', 'Finance'));
    const b = await app.createEmployee(hr, syntheticProfile('Blake Sample', 'Finance'));
    const idA = a.employee.account.id,
      idB = b.employee.account.id;
    const events0 = (await events(app)).length;
    const unchanged = async () => {
      assert.equal((await named(hr, 'Finance')).prefix, 'FN');
      assert.equal(await named(hr, 'Money'), undefined);
      assert.equal(profileOf(app, idA).job.department, 'Finance');
      assert.equal(profileOf(app, idB).job.department, 'Finance');
      assert.equal((await events(app)).length, events0);
    };

    app.firestore.fail(14, { only: ['commit'] });
    const down = await patch(hr, finance.id, { name: 'Money' });
    assert.deepEqual([down.status, down.body.code], [503, 'PROFILE_STORAGE_UNAVAILABLE']);
    await unchanged();

    app.firestore.fail(4, { only: ['query'] });
    const slow = await patch(hr, finance.id, { name: 'Money' });
    assert.deepEqual([slow.status, slow.body.code], [504, 'PROFILE_STORAGE_TIMEOUT']);
    await unchanged();

    // A rename together with a prefix change or archive is all or nothing too.
    app.firestore.fail(14, { only: ['commit'] });
    const both = await patch(hr, finance.id, { name: 'Money', prefix: 'MN', archived: true });
    assert.equal(both.status, 503);
    await unchanged();
    assert.equal((await named(hr, 'Finance')).archived, false);

    // The commit of the database fails after the profiles were renamed: the
    // profiles are put back.
    app.database.fail('08006', { match: /^UPDATE departments/ });
    const lost = await patch(hr, finance.id, { name: 'Money' });
    assert.deepEqual([lost.status, lost.body.code], [503, 'ACCOUNTS_UNAVAILABLE']);
    await unchanged();

    const retried = await patch(hr, finance.id, { name: 'Money' });
    assert.equal(retried.status, 200, retried.text);
    assert.equal(retried.body.updatedProfiles, 2);
    assert.equal(profileOf(app, idA).job.department, 'Money');
    assert.equal(profileOf(app, idB).job.department, 'Money');
    // Nothing leaked into logs: the injected error text mentions a path.
    assert.ok(app.logs.every((line) => !/private chat text|employeeProfiles/.test(line)));
  });
});

test('archived departments leave the new-hire choices but stay valid as the stored value', async () => {
  await withApp(async (app) => {
    const hr = await app.hrBrowser();
    const { employee } = await app.createEmployee(hr, syntheticProfile('Avery Example', 'Finance'));
    const id = employee.account.id;
    const finance = await named(hr, 'Finance');

    const archived = await patch(hr, finance.id, { archived: true });
    assert.equal(archived.status, 200, archived.text);
    assert.deepEqual(archived.body, {
      department: { ...finance, archived: true, employees: 1 },
      updatedProfiles: 0,
    });
    // Not a choice for a new hire, not in the autofill's names.
    const refused = await create(hr, 'Finance', 'Blake Sample');
    assert.equal(refused.status, 400);
    assert.deepEqual(problems(refused), [
      { field: 'job.department', problem: 'invalid_department' },
    ]);
    assert.ok(!(await app.accounts.activeDepartmentNames()).includes('Finance'));
    await assert.rejects(
      app.accounts.createEmployeeAccount({
        profile: syntheticProfile('Casey Example', 'Finance'),
        actorId: (await hr.get('/api/auth/session')).body.account.id,
      }),
      (error) => error.code === 'PROFILE_INVALID',
    );
    assert.equal((await app.rows("SELECT id FROM accounts WHERE role = 'employee'")).length, 1);

    // The existing employee's profile stays editable with that stored value...
    const put = (department, fullName = 'Avery Q. Example') =>
      hr.put(`/api/hr/employees/${id}/profile`, {
        profile: syntheticProfile(fullName, department),
      });
    const kept = await put('Finance');
    assert.equal(kept.status, 200, kept.text);
    assert.equal(kept.body.employee.profile.job.department, 'Finance');
    assert.equal(kept.body.employee.account.username, 'FN-0001');
    // ...but nobody else can be moved into it, and other departments still work.
    const other = await app.createEmployee(
      hr,
      syntheticProfile('Drew Example', 'Customer Success'),
    );
    const moved = await hr.put(`/api/hr/employees/${other.employee.account.id}/profile`, {
      profile: syntheticProfile('Drew Example', 'Finance'),
    });
    assert.deepEqual(problems(moved), [{ field: 'job.department', problem: 'invalid_department' }]);
    assert.equal((await put('Customer Success')).status, 200);
    // Once it was left, the archived name is no longer the stored value.
    assert.equal((await put('Finance')).status, 400);

    // Restoring brings it back as a choice; the prefix and counter continued.
    const restored = await patch(hr, finance.id, { archived: false });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.department.archived, false);
    assert.equal(idOf(await create(hr, 'Finance', 'Blake Sample')), 'FN-0002');
    assert.ok((await app.accounts.activeDepartmentNames()).includes('Finance'));
    // Archiving twice, or restoring an active one, is a no-op without events.
    const before = (await events(app)).length;
    await patch(hr, finance.id, { archived: false });
    assert.equal((await events(app)).length, before);
    // archived must be true or false.
    for (const archivedValue of ['true', 1, null]) {
      const bad = await patch(hr, finance.id, { archived: archivedValue });
      assert.deepEqual([bad.status, bad.body.code], [400, 'DEPARTMENT_INVALID']);
    }
    // An archived department keeps its prefix reserved.
    await patch(hr, finance.id, { archived: true });
    assert.equal((await add(hr, 'Accounts', 'FN')).body.code, 'DEPARTMENT_PREFIX_TAKEN');
  });
});

test('PATCH needs a known department and a change to make', async () => {
  await withApp(async (app) => {
    const hr = await app.hrBrowser();
    const finance = await named(hr, 'Finance');
    for (const body of [{}, { color: 'red' }, { name: 'Money', id: 'x' }, []]) {
      const response = await patch(hr, finance.id, body);
      assert.deepEqual([response.status, response.body.code], [400, 'DEPARTMENT_INVALID']);
    }
    for (const id of ['00000000-0000-4000-8000-000000000000', 'not-an-id', '1'.repeat(40)]) {
      const response = await patch(hr, id, { archived: true });
      assert.deepEqual([response.status, response.body.code], [404, 'DEPARTMENT_NOT_FOUND'], id);
    }
    assert.equal((await named(hr, 'Finance')).archived, false);
  });
});

test('department changes write audit events with the actor and what changed, and never a secret', async () => {
  await withApp(async (app) => {
    const hr = await app.hrBrowser();
    const hrId = (await hr.get('/api/auth/session')).body.account.id;
    const legal = (await add(hr, 'Legal', 'LG')).body.department;
    await patch(hr, legal.id, { name: 'Legal & Compliance' });
    await patch(hr, legal.id, { prefix: 'LGL' });
    await patch(hr, legal.id, { archived: true });
    await patch(hr, legal.id, { archived: false });
    await patch(hr, legal.id, { name: 'Legal', prefix: 'LG', archived: true });
    await patch(hr, legal.id, { archived: true }); // no change, no event
    const department = (name, prefix) => ({ id: legal.id, name, prefix });
    assert.deepEqual(await events(app), [
      {
        action: 'department_created',
        actor_id: hrId,
        target_id: null,
        detail: { department: department('Legal', 'LG') },
      },
      {
        action: 'department_updated',
        actor_id: hrId,
        target_id: null,
        detail: {
          department: department('Legal & Compliance', 'LG'),
          changes: { name: { from: 'Legal', to: 'Legal & Compliance' } },
        },
      },
      {
        action: 'department_updated',
        actor_id: hrId,
        target_id: null,
        detail: {
          department: department('Legal & Compliance', 'LGL'),
          changes: { prefix: { from: 'LG', to: 'LGL' } },
        },
      },
      {
        action: 'department_archived',
        actor_id: hrId,
        target_id: null,
        detail: { department: department('Legal & Compliance', 'LGL') },
      },
      {
        action: 'department_restored',
        actor_id: hrId,
        target_id: null,
        detail: { department: department('Legal & Compliance', 'LGL') },
      },
      {
        action: 'department_updated',
        actor_id: hrId,
        target_id: null,
        detail: {
          department: department('Legal', 'LG'),
          changes: {
            name: { from: 'Legal & Compliance', to: 'Legal' },
            prefix: { from: 'LGL', to: 'LG' },
          },
        },
      },
      {
        action: 'department_archived',
        actor_id: hrId,
        target_id: null,
        detail: { department: department('Legal', 'LG') },
      },
    ]);
    // Other events have no detail, and the target label rule is untouched.
    assert.deepEqual(
      await app.rows("SELECT detail FROM account_events WHERE action = 'hr_account_created'"),
      [{ detail: null }],
    );
    const text = JSON.stringify(await events(app));
    assert.ok(!/password|hash|token/i.test(text));
    // A refused change records nothing.
    const count = (await events(app)).length;
    await add(hr, 'Legal', 'ZZ');
    await patch(hr, legal.id, { prefix: 'HR' });
    assert.equal((await events(app)).length, count);
  });
});

test('departments are for HR only, behind the sign-in and the same-origin check', async () => {
  await withApp(async (app) => {
    const hr = await app.hrBrowser();
    const finance = await named(hr, 'Finance');
    const staff = await app.readyEmployee(hr);
    const anonymous = app.browser();
    const attempts = (browser) => [
      browser.get('/api/hr/departments'),
      browser.post('/api/hr/departments', { name: 'Legal', prefix: 'LG' }),
      patch(browser, finance.id, { archived: true }),
    ];
    for (const response of await Promise.all(attempts(anonymous)))
      assert.deepEqual([response.status, response.body.code], [401, 'AUTH_REQUIRED']);
    for (const response of await Promise.all(attempts(staff.browser)))
      assert.deepEqual([response.status, response.body.code], [403, 'HR_ROLE_REQUIRED']);
    const foreign = { Origin: 'https://evil.example' };
    for (const response of [
      await hr.get('/api/hr/departments', foreign),
      await hr.post('/api/hr/departments', { name: 'Legal', prefix: 'LG' }, foreign),
      await hr.request('PATCH', `/api/hr/departments/${finance.id}`, { archived: true }, foreign),
    ]) {
      assert.deepEqual([response.status, response.body.code], [403, 'CROSS_ORIGIN_REJECTED']);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    // A forced password change blocks HR's own routes too, and nothing changed.
    assert.equal((await list(hr)).length, 6);
    assert.equal((await named(hr, 'Finance')).archived, false);
    assert.equal((await events(app)).length, 0);
  });
  // Accounts off: a fixed 503.
  await withApp({ accounts: false }, async (app) => {
    const response = await app.browser().get('/api/hr/departments');
    assert.deepEqual([response.status, response.body.code], [503, 'ACCOUNTS_NOT_CONFIGURED']);
  });
});

test('PATCH shares the POST rate limit', async () => {
  await withApp(async (app) => {
    const hr = await app.hrBrowser();
    const finance = await named(hr, 'Finance');
    let last;
    for (let i = 0; i < 70; i++) last = await patch(hr, finance.id, { archived: false });
    assert.equal(last.status, 429);
  });
});

test('the seed list is the fallback for validateProfile only when no active names are given', () => {
  const profile = (department) => ({ job: { fullName: 'Avery', department } });
  assert.doesNotThrow(() => validateProfile(profile('Finance')));
  assert.throws(() => validateProfile(profile('Legal')), { code: 'PROFILE_INVALID' });
  assert.doesNotThrow(() => validateProfile(profile('Legal'), { activeDepartments: ['Legal'] }));
  assert.throws(() => validateProfile(profile('Finance'), { activeDepartments: ['Legal'] }), {
    code: 'PROFILE_INVALID',
  });
});

test('the autofill enum and answer check follow the active departments for each request', async () => {
  const requests = [];
  const answers = ['Legal', 'Finance'];
  const model = async (request) => {
    requests.push(request);
    const text = JSON.stringify({
      job: { fullName: 'Avery Example', department: answers.shift() },
    });
    return { candidates: [{ content: { parts: [{ text }] } }] };
  };
  await withApp(
    { env: { GOOGLE_CLOUD_PROJECT: 'synthetic-project' }, autofill: { model } },
    async (app) => {
      const hr = await app.hrBrowser();
      assert.equal((await add(hr, 'Legal', 'LG')).status, 201);
      await patch(hr, (await named(hr, 'Finance')).id, { archived: true });
      const upload = async () => {
        const response = await fetch(`${app.url}/api/hr/employees/autofill`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-File-Name': 'cv.txt',
            cookie: hr.cookieHeader,
          },
          body: Buffer.from('Synthetic CV: Avery Example, legal counsel'),
        });
        return { status: response.status, body: await response.json() };
      };
      const first = await upload();
      assert.equal(first.status, 200);
      assert.equal(first.body.profile.job.department, 'Legal');
      assert.deepEqual(first.body.warnings, []);
      // The archived department is not offered, and an answer naming it is dropped.
      const second = await upload();
      assert.equal(second.body.profile.job.department, '');
      assert.deepEqual(second.body.warnings, [
        { field: 'job.department', problem: 'invalid_department' },
      ]);
      for (const request of requests) {
        const { enum: names } =
          request.generationConfig.responseSchema.properties.job.properties.department;
        assert.deepEqual(names, [
          'Customer Success',
          'Legal',
          'Operations & Facilities',
          'People & Culture',
          'Product & Engineering',
          'Sales & Marketing',
        ]);
        assert.match(
          request.systemInstruction.parts[0].text,
          /departments: Customer Success, Legal, /,
        );
        assert.doesNotMatch(request.systemInstruction.parts[0].text, /Finance/);
      }
    },
  );
});
