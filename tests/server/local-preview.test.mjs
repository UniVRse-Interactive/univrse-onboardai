import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLocalPreview, localPreviewRequest } from '../../scripts/local-preview-guard.mjs';
import { startLocalPreview } from '../../scripts/start-local-preview.mjs';

test('preview fails closed outside explicit local development', () => {
  for (const env of [
    {},
    { NODE_ENV: 'production' },
    { NODE_ENV: 'test' },
    { NODE_ENV: 'development', K_SERVICE: 'web' },
    { NODE_ENV: 'development', CLOUD_RUN_JOB: 'job' },
    { NODE_ENV: 'development', K_REVISION: 'revision' },
    { NODE_ENV: 'development', HOST: '0.0.0.0' },
  ])
    assert.throws(() => assertLocalPreview(env, []));
  assert.throws(() => assertLocalPreview({ NODE_ENV: 'development' }, ['--production']));
  assert.doesNotThrow(() => assertLocalPreview({ NODE_ENV: 'development' }, []));
});

test('preview rejects nonlocal, forwarded and cross-origin requests', () => {
  const request = (headers = {}, peer = '127.0.0.1') => ({
    headers: { host: 'localhost:3000', ...headers },
    socket: { remoteAddress: peer },
  });
  assert.equal(localPreviewRequest(request()), true);
  for (const req of [
    request({}, '192.168.0.1'),
    request({ host: 'example.com' }),
    request({ origin: 'https://example.com' }),
    request({ referer: 'http://localhost:9999/hr' }),
    request({ 'x-forwarded-for': '127.0.0.1' }),
    request({ forwarded: 'for=127.0.0.1' }),
    request({ 'x-forwarded-host': 'localhost' }),
  ])
    assert.equal(localPreviewRequest(req), false);
});

test('preview opens employee and HR APIs without cookies using isolated accounts', async () => {
  const preview = await startLocalPreview({ env: { NODE_ENV: 'development' }, port: 0 });
  try {
    const get = (path, page = '/dashboard') =>
      fetch(preview.url + path, { headers: { referer: preview.url + page } });
    const employee = await (await get('/api/auth/session')).json();
    assert.equal(employee.account.role, 'employee');
    assert.equal(employee.account.mustChangePassword, false);
    const hr = await (await get('/api/auth/session', '/hr')).json();
    assert.equal(hr.account.role, 'hr');
    assert.notEqual(hr.account.id, employee.account.id);
    assert.equal((await get('/api/hr/employees', '/hr')).status, 200);
    assert.equal((await get('/api/hr/employees')).status, 403);
    const page = await (await get('/dashboard')).text();
    assert.match(page, /Local preview · sample data/);
    assert.equal(
      (
        await fetch(preview.url + '/api/auth/session', {
          headers: { origin: 'https://example.com' },
        })
      ).status,
      403,
    );
  } finally {
    await preview.close();
  }
});
