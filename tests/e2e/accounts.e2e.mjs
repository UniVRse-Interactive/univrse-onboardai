// Live API checks for HR-managed employee accounts (issue #23).
// Needs a running app with accounts on and an HR account:
//   BASE_URL=http://localhost:3100 E2E_HR_ID=... E2E_HR_PASSWORD=... \
//     node --test tests/e2e/accounts.e2e.mjs
//
// Environment:
//   BASE_URL              App under test. Default http://localhost:3100.
//   E2E_HR_ID             HR account ID (required, the flow is skipped without it).
//   E2E_HR_PASSWORD       HR account password (required).
//   E2E_CLEANUP           1 or 0. Delete the synthetic employee afterwards. Default 1 when
//                         BASE_URL is localhost, 127.0.0.1 or [::1], otherwise 0.
//                         The API has no delete route, so cleanup removes the account,
//                         sessions and events through `docker compose exec postgres psql`
//                         (run from the current directory) and removes the Firestore
//                         emulator documents over REST.
//   E2E_FIRESTORE_REST    Emulator documents URL. Default
//                         http://127.0.0.1:8681/v1/projects/demo-onboardai/databases/(default)/documents
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const base = process.env.BASE_URL || 'http://localhost:3100';
const hrId = process.env.E2E_HR_ID;
const hrPassword = process.env.E2E_HR_PASSWORD;
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname);
const cleanup = (process.env.E2E_CLEANUP ?? (isLocal ? '1' : '0')) === '1';
const emulator =
  process.env.E2E_FIRESTORE_REST ||
  'http://127.0.0.1:8681/v1/projects/demo-onboardai/databases/(default)/documents';
const run = promisify(execFile);
const suffix = Date.now().toString(36).slice(-5).toUpperCase();
const empId = `E2E-${suffix}`;
const tempPw = `Temp-${suffix}-Aa1!x`;
const newPw = `Own-${suffix}-Bb2!y`;
const resetPw = `Reset-${suffix}-Cc3!z`;

class Client {
  cookie = '';
  async call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, json, text };
  }
  signIn(username, password) {
    return this.call('POST', '/api/auth/sign-in', { username, password });
  }
}

const profile = {
  job: { fullName: 'E2E Person' },
};

test('health', async () => {
  const r = await new Client().call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
});

test('accounts flow', { skip: !hrId || !hrPassword }, async (t) => {
  t.after(async () => {
    if (cleanup && createdId) await removeEmployee(createdId);
  });
  const hr = new Client();
  assert.equal((await hr.signIn(hrId, hrPassword)).status, 200);

  await t.test('no session gets 401 on every HR endpoint', async () => {
    const anon = new Client();
    for (const [m, p, b] of [
      ['GET', '/api/hr/employees'],
      ['POST', '/api/hr/employees', {}],
      ['GET', `/api/hr/employees/${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}`],
      ['PUT', `/api/hr/employees/${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}/profile`, {}],
      ['POST', `/api/hr/employees/${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}/password`, {}],
      ['PUT', `/api/hr/employees/${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}/status`, {}],
    ]) {
      const r = await anon.call(m, p, b);
      assert.equal(r.status, 401, `${m} ${p}`);
    }
    assert.equal((await anon.call('GET', '/api/me/profile')).status, 401);
  });

  let created;
  let createdId;
  await t.test('HR creates an employee', async () => {
    const r = await hr.call('POST', '/api/hr/employees', {
      username: empId,
      temporaryPassword: tempPw,
      profile,
    });
    assert.equal(r.status, 201, r.text);
    created = r.json.employee.account;
    createdId = created.id;
    assert.ok(created.id);
    assert.ok(!r.text.includes(tempPw));
  });

  const emp = new Client();
  await t.test('employee must change the temporary password first', async () => {
    const r = await emp.signIn(empId, tempPw);
    assert.equal(r.status, 200);
    assert.equal(r.json.account.mustChangePassword, true);
    assert.equal((await emp.call('GET', '/api/me/profile')).status, 403);
    assert.equal((await emp.call('GET', '/api/conversations')).status, 403);
    const c = await emp.call('POST', '/api/auth/password', {
      currentPassword: tempPw,
      newPassword: newPw,
    });
    assert.equal(c.status, 200, c.text);
    assert.equal(c.json.account.mustChangePassword, false);
    assert.equal((await emp.call('GET', '/api/me/profile')).status, 200);
  });

  await t.test('employee session gets 403 on every HR endpoint', async () => {
    const id = created.id;
    for (const [m, p, b] of [
      ['GET', '/api/hr/employees'],
      ['POST', '/api/hr/employees', {}],
      ['GET', `/api/hr/employees/${id}`],
      ['PUT', `/api/hr/employees/${id}/profile`, {}],
      ['POST', `/api/hr/employees/${id}/password`, {}],
      ['PUT', `/api/hr/employees/${id}/status`, { status: 'disabled' }],
    ]) {
      const r = await emp.call(m, p, b);
      assert.equal(r.status, 403, `${m} ${p} ${r.text}`);
      assert.equal(r.json.code, 'HR_ROLE_REQUIRED');
    }
  });

  await t.test('case-variant duplicate ID is USERNAME_TAKEN', async () => {
    const r = await hr.call('POST', '/api/hr/employees', {
      username: empId.toLowerCase(),
      temporaryPassword: tempPw,
      profile,
    });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'USERNAME_TAKEN');
  });

  await t.test('reset: old password fails, session ends, new works', async () => {
    const r = await hr.call('POST', `/api/hr/employees/${created.id}/password`, {
      temporaryPassword: resetPw,
    });
    assert.equal(r.status, 200, r.text);
    assert.equal((await new Client().signIn(empId, newPw)).status, 401);
    // the employee's existing session
    const after = await emp.call('GET', '/api/me/profile');
    assert.equal(after.status, 401, 'old session must end after reset');
    assert.equal((await emp.call('GET', '/api/auth/session')).status, 401);
    const again = new Client();
    const ok = await again.signIn(empId, resetPw);
    assert.equal(ok.status, 200);
    assert.equal(ok.json.account.mustChangePassword, true);
  });

  await t.test('disabled account cannot sign in, enabled can again', async () => {
    const d = await hr.call('PUT', `/api/hr/employees/${created.id}/status`, {
      status: 'disabled',
    });
    assert.equal(d.status, 200, d.text);
    const blocked = await new Client().signIn(empId, resetPw);
    const unknown = await new Client().signIn(`NOBODY-${suffix}`, resetPw);
    assert.equal(blocked.status, 401);
    assert.equal(blocked.text, unknown.text, 'disabled must look like unknown');
    assert.equal(blocked.status, unknown.status);
    const e = await hr.call('PUT', `/api/hr/employees/${created.id}/status`, { status: 'active' });
    assert.equal(e.status, 200);
    assert.equal((await new Client().signIn(empId, resetPw)).status, 200);
  });

  await t.test(
    'five wrong passwords lock; same answer as unknown ID; sessions survive',
    async () => {
      const live = new Client();
      assert.equal((await live.signIn(empId, resetPw)).status, 200);
      const unknown = await new Client().signIn(`NOBODY-${suffix}`, 'wrong-password-1');
      const answers = [];
      for (let i = 0; i < 6; i++)
        answers.push(await new Client().signIn(empId, 'wrong-password-1'));
      for (const a of answers) {
        assert.equal(a.status, unknown.status);
        assert.equal(a.text, unknown.text);
      }
      // correct password is refused while locked
      const locked = await new Client().signIn(empId, resetPw);
      assert.equal(locked.status, unknown.status);
      assert.equal(locked.text, unknown.text);
      // existing session keeps working; password change answers 429 ACCOUNT_LOCKED
      assert.equal((await live.call('GET', '/api/auth/session')).status, 200);
      const pw = await live.call('POST', '/api/auth/password', {
        currentPassword: resetPw,
        newPassword: newPw,
      });
      assert.equal(pw.status, 429, pw.text);
      assert.equal(pw.json.code, 'ACCOUNT_LOCKED');
    },
  );

  await t.test('sign-out ends the session', async () => {
    const c = new Client();
    await hr.call('POST', `/api/hr/employees/${created.id}/password`, {
      temporaryPassword: resetPw,
    });
    // reset by HR may or may not clear a lock; only assert HR session is still valid
    assert.equal((await hr.call('GET', '/api/auth/session')).status, 200);
    const out = await hr.call('POST', '/api/auth/sign-out');
    assert.equal(out.status, 204);
    assert.equal((await c.call('GET', '/api/hr/employees')).status, 401);
  });
});

// Removes the synthetic employee. The IDs are database-generated UUIDs, never user input.
async function removeEmployee(id) {
  const uuid = /^[0-9a-f-]{36}$/;
  if (!uuid.test(id)) throw new Error('refusing to clean up a non-UUID id');
  await run('docker', [
    'compose',
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'onboardai',
    '-d',
    'onboardai',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `delete from account_events where actor_id = '${id}' or target_id = '${id}'; ` +
      `delete from sessions where account_id = '${id}'; delete from accounts where id = '${id}';`,
  ]);
  const owner = `account:${id}`;
  const del = (name) => fetch(`${emulator}/${name}`, { method: 'DELETE' });
  await del(`employeeProfiles/${id}`);
  for (const collection of ['conversations', 'supportPreferences']) {
    const list = await (await fetch(`${emulator}/${collection}?pageSize=300`)).json();
    for (const doc of list.documents || []) {
      if (doc.fields?.owner?.stringValue !== owner) continue;
      const name = doc.name.split('/documents/')[1];
      if (collection === 'conversations') {
        const msgs = await (await fetch(`${emulator}/${name}/messages?pageSize=300`)).json();
        for (const m of msgs.documents || []) await del(m.name.split('/documents/')[1]);
      }
      await del(name);
    }
  }
}
