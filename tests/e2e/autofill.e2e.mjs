// Live API checks for HR profile autofill (issue #26): POST /api/hr/employees/autofill.
//   BASE_URL=http://localhost:3103 E2E_HR_ID=... E2E_HR_PASSWORD=... \
//     [E2E_EXPECT=configured|not-configured] node --test tests/e2e/autofill.e2e.mjs
//
// Environment:
//   BASE_URL          App under test. Default http://localhost:3103.
//   E2E_HR_ID         HR account ID (required for the flow, otherwise it is skipped).
//   E2E_HR_PASSWORD   HR account password.
//   E2E_EXPECT        What a valid file should return: "configured" (200, needs Gemini
//                     credentials), "unavailable" (default, 503 AUTOFILL_UNAVAILABLE when
//                     there are no credentials) or "not-configured" (503
//                     AUTOFILL_NOT_CONFIGURED, GOOGLE_CLOUD_PROJECT empty).
//   E2E_CLEANUP       1 or 0. Delete the synthetic employee (ID starts with QA-) through
//                     `docker compose exec postgres psql` (run from the repo root).
//                     Default 1 for localhost. Only that one account is touched.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const base = process.env.BASE_URL || 'http://localhost:3103';
const hrId = process.env.E2E_HR_ID;
const hrPassword = process.env.E2E_HR_PASSWORD;
const expect = process.env.E2E_EXPECT || 'unavailable';
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname);
const cleanup = (process.env.E2E_CLEANUP ?? (isLocal ? '1' : '0')) === '1';
const run = promisify(execFile);
const suffix = Date.now().toString(36).slice(-5).toUpperCase();
const empId = `QA-E2E-${suffix}`;
const pw = `Temp-${suffix}-Aa1!x`;

class Client {
  cookie = '';
  async call(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body,
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
  json(method, path, obj) {
    return this.call(method, path, JSON.stringify(obj), { 'content-type': 'application/json' });
  }
  autofill(name, bytes) {
    return this.call('POST', '/api/hr/employees/autofill', bytes, {
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent(name),
    });
  }
}

test('autofill endpoint', { skip: !hrId || !hrPassword }, async (t) => {
  let createdId;
  t.after(async () => {
    if (!cleanup || !createdId || !/^[0-9a-f-]{36}$/.test(createdId)) return;
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
      `delete from account_events where actor_id = '${createdId}' or target_id = '${createdId}'; ` +
        `delete from sessions where account_id = '${createdId}'; delete from accounts where id = '${createdId}';`,
    ]);
    await fetch(
      `http://127.0.0.1:8681/v1/projects/demo-onboardai/databases/(default)/documents/employeeProfiles/${createdId}`,
      { method: 'DELETE' },
    );
  });

  // Without GOOGLE_CLOUD_PROJECT the endpoint answers 503 AUTOFILL_NOT_CONFIGURED before
  // it looks at the file, so the file checks below expect that instead.
  const notConfigured = expect === 'not-configured';
  const checkNotConfigured = (r) => {
    assert.equal(r.status, 503, r.text);
    assert.equal(r.json.code, 'AUTOFILL_NOT_CONFIGURED');
  };
  const small = Buffer.from('Name: QA Person\nJob title: Analyst\n');

  await t.test('no session gets 401', async () => {
    const r = await new Client().autofill('a.txt', small);
    assert.equal(r.status, 401, r.text);
  });

  const hr = new Client();
  assert.equal(
    (await hr.json('POST', '/api/auth/sign-in', { username: hrId, password: hrPassword })).status,
    200,
  );
  const created = await hr.json('POST', '/api/hr/employees', {
    username: empId,
    temporaryPassword: pw,
    profile: { job: { fullName: 'QA E2E' } },
  });
  assert.equal(created.status, 201, created.text);
  createdId = created.json.employee.account.id;

  await t.test('employee session gets 403', async () => {
    const emp = new Client();
    assert.equal(
      (await emp.json('POST', '/api/auth/sign-in', { username: empId, password: pw })).status,
      200,
    );
    const newPw = `Own-${suffix}-Bb2!y`;
    assert.equal(
      (await emp.json('POST', '/api/auth/password', { currentPassword: pw, newPassword: newPw }))
        .status,
      200,
    );
    const r = await emp.autofill('a.txt', small);
    assert.equal(r.status, 403, r.text);
    assert.equal(r.json.code, 'HR_ROLE_REQUIRED');
  });

  await t.test('wrong file types get 400', async () => {
    for (const name of ['setup.exe', 'notes.csv', 'archive.zip', 'noextension']) {
      const r = await hr.autofill(name, small);
      if (notConfigured) return checkNotConfigured(r);
      assert.equal(r.status, 400, `${name} ${r.text}`);
      assert.equal(r.json.code, 'AUTOFILL_FILE_INVALID');
    }
  });

  await t.test('empty file gets 400', async () => {
    const r = await hr.autofill('empty.txt', Buffer.alloc(0));
    if (notConfigured) return checkNotConfigured(r);
    assert.equal(r.status, 400, r.text);
  });

  await t.test('file over 5 MiB gets 413', async () => {
    const r = await hr.autofill('big.txt', Buffer.alloc(5 * 1024 * 1024 + 1, 97));
    if (notConfigured) return checkNotConfigured(r);
    assert.equal(r.status, 413, r.text);
    assert.equal(r.json.code, 'AUTOFILL_FILE_TOO_LARGE');
  });

  await t.test(`valid file returns the ${expect} outcome`, async () => {
    const r = await hr.autofill('details.txt', small);
    if (expect === 'configured') {
      assert.equal(r.status, 200, r.text);
      assert.ok(r.json.profile && Array.isArray(r.json.filled) && Array.isArray(r.json.warnings));
    } else if (expect === 'not-configured') {
      assert.equal(r.status, 503, r.text);
      assert.equal(r.json.code, 'AUTOFILL_NOT_CONFIGURED');
    } else {
      assert.equal(r.status, 503, r.text);
      assert.equal(r.json.code, 'AUTOFILL_UNAVAILABLE');
    }
  });

  await t.test('exactly 5 MiB is not rejected as too large', async () => {
    const r = await hr.autofill('exact.txt', Buffer.alloc(5 * 1024 * 1024, 97));
    assert.notEqual(r.status, 413, r.text);
  });
});
