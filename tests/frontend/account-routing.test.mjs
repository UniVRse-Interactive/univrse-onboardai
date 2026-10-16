import test from 'node:test';
import assert from 'node:assert/strict';
import {
  afterAccountAction,
  landingPath,
  routeDecision,
} from '../../src/access/account-routing.mjs';

const hr = { id: '1', username: 'H', role: 'hr', mustChangePassword: false };
const emp = { id: '2', username: 'E', role: 'employee', mustChangePassword: false };

test('accounts off keeps every page as it is', () => {
  for (const path of ['/login', '/signup', '/hr', '/profile', '/mira'])
    assert.deepEqual(routeDecision({ accounts: false, path }), { type: 'render' });
});
test('landing page follows account.role', () => {
  assert.equal(landingPath(hr), '/hr');
  assert.equal(landingPath(emp), '/mira');
});
test('signed-in users leave the login pages by role', () => {
  assert.deepEqual(routeDecision({ accounts: true, account: hr, path: '/login' }), {
    type: 'redirect',
    to: '/hr',
  });
  assert.deepEqual(routeDecision({ accounts: true, account: emp, path: '/' }), {
    type: 'redirect',
    to: '/mira',
  });
});
test('signup leads to sign-in', () => {
  assert.deepEqual(routeDecision({ accounts: true, path: '/signup' }), {
    type: 'redirect',
    to: '/login',
  });
});
test('forced change shows before anything else', () => {
  const account = { ...emp, mustChangePassword: true };
  for (const path of ['/login', '/mira', '/dashboard'])
    assert.equal(routeDecision({ accounts: true, account, path }).type, 'change-password');
});
test('My profile needs an account; guest pages do not', () => {
  assert.equal(routeDecision({ accounts: true, path: '/profile' }).to, '/login');
  assert.equal(routeDecision({ accounts: true, account: emp, path: '/profile' }).type, 'render');
  assert.equal(routeDecision({ accounts: true, path: '/hr' }).type, 'render');
  assert.equal(routeDecision({ accounts: true, path: '/employee' }).type, 'render');
});
test('gated paths wait for the session check', () => {
  assert.equal(routeDecision({ accounts: null, path: '/login' }).type, 'loading');
  assert.equal(routeDecision({ accounts: true, loading: true, path: '/hr' }).type, 'loading');
  assert.equal(routeDecision({ accounts: null, path: '/mira' }).type, 'render');
});
test('app-wide account actions', () => {
  assert.deepEqual(afterAccountAction('sign-in', emp), {
    account: null,
    to: '/login',
    notice: true,
  });
  const r = afterAccountAction('change-password', emp);
  assert.equal(r.account.mustChangePassword, true);
  assert.equal(r.to, null);
  assert.equal(afterAccountAction('change-password', null).account, null);
});

import { sessionCheckOutcome } from '../../src/access/account-routing.mjs';
import { ensureSession, registerSessionVerifier } from '../../src/access/account-api.mjs';

test('repeat session check: a missing or ended session returns to sign-in', () => {
  assert.equal(sessionCheckOutcome(emp, { account: null }).type, 'expired');
  assert.equal(
    sessionCheckOutcome(emp, { error: { status: 401, code: 'SESSION_EXPIRED' } }).type,
    'expired',
  );
  assert.equal(sessionCheckOutcome(emp, { account: { ...emp } }).type, 'ok');
  assert.equal(sessionCheckOutcome(null, { account: null }).type, 'ok');
});
test('repeat session check: other failures never sign the user out', () => {
  assert.equal(
    sessionCheckOutcome(emp, { error: { status: 503, code: 'ACCOUNTS_UNAVAILABLE' } }).type,
    'ok',
  );
  assert.equal(sessionCheckOutcome(emp, { error: { status: 0, code: '' } }).type, 'ok');
});
test('repeat session check: a changed account or forced change updates state', () => {
  const r = sessionCheckOutcome(emp, { account: { ...emp, mustChangePassword: true } });
  assert.equal(r.type, 'update');
  assert.equal(sessionCheckOutcome(emp, { account: hr }).type, 'update');
});
test('ensureSession allows sending without a verifier and obeys one', async () => {
  assert.equal(await ensureSession(), true);
  const off = registerSessionVerifier(async () => false);
  assert.equal(await ensureSession(), false);
  off();
  assert.equal(await ensureSession(), true);
});
