import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dummyPasswordHash,
  hashPassword,
  parsePasswordHash,
  passwordProblem,
  scryptDefaults,
  verifyPassword,
} from '../../server/password-hashing.mjs';

test('passwords are hashed with scrypt, a random 16-byte salt and the parameters stored with the hash', async () => {
  const password = 'Synthetic pass phrase 1';
  const first = await hashPassword(password),
    second = await hashPassword(password);
  for (const stored of [first, second]) {
    assert.match(stored, /^scrypt\$n=32768,r=8,p=1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/);
    assert.ok(!stored.includes(password));
    const parsed = parsePasswordHash(stored);
    assert.equal(parsed.salt.length, 16);
    assert.equal(parsed.key.length, scryptDefaults.keyLength);
    assert.deepEqual([parsed.n, parsed.r, parsed.p], [32768, 8, 1]);
  }
  // A new salt every time, so equal passwords never share a hash.
  assert.notEqual(first, second);
  assert.notEqual(first.split('$')[2], second.split('$')[2]);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword(password, second), true);
  assert.equal(await verifyPassword('Synthetic pass phrase 2', first), false);
  assert.equal(await verifyPassword(password.toLowerCase(), first), false);
});

test('verification uses the stored parameters, so stronger settings can be introduced later', async () => {
  const cheap = await hashPassword('Synthetic pass phrase 1', {
    n: 1024,
    r: 8,
    p: 1,
    keyLength: 32,
  });
  assert.match(cheap, /^scrypt\$n=1024,r=8,p=1\$/);
  assert.equal(await verifyPassword('Synthetic pass phrase 1', cheap), true);
  assert.equal(await verifyPassword('Synthetic pass phrase 2', cheap), false);
});

test('damaged or unsafe stored hashes never verify and never run scrypt with them', async () => {
  const good = await hashPassword('Synthetic pass phrase 1', {
    n: 1024,
    r: 8,
    p: 1,
    keyLength: 64,
  });
  const [, , salt, key] = good.split('$');
  for (const stored of [
    null,
    '',
    'plain-text-password',
    `bcrypt$n=1024,r=8,p=1$${salt}$${key}`,
    `scrypt$n=1000,r=8,p=1$${salt}$${key}`, // n not a power of two
    `scrypt$n=4194304,r=8,p=1$${salt}$${key}`, // n too large
    `scrypt$n=1024,r=99,p=1$${salt}$${key}`,
    `scrypt$n=1024,r=8,p=1$${salt.slice(0, 10)}$${key}`, // short salt
    `scrypt$n=1024,r=8,p=1$${salt}$${key.slice(0, 20)}`, // short key
  ]) {
    assert.equal(parsePasswordHash(stored), null, String(stored));
    assert.equal(await verifyPassword('Synthetic pass phrase 1', stored), false);
  }
  assert.equal(await verifyPassword(undefined, good), false);
});

test('the dummy hash for unknown IDs is a real hash with the current parameters', async () => {
  const dummy = await dummyPasswordHash();
  assert.match(dummy, /^scrypt\$n=32768,r=8,p=1\$/);
  assert.equal(dummy, await dummyPasswordHash());
  assert.equal(await verifyPassword('anything at all', dummy), false);
});

test('password rules: 8 to 200 characters and not the same as the ID', () => {
  assert.equal(passwordProblem('long enough', 'EMP-0001'), null);
  assert.equal(passwordProblem('x'.repeat(200), 'EMP-0001'), null);
  assert.match(passwordProblem('short', 'EMP-0001'), /at least 8/);
  assert.match(passwordProblem('x'.repeat(201), 'EMP-0001'), /at most 200/);
  assert.match(passwordProblem('emp-0001x', 'EMP-0001x'), /same as the ID/);
  assert.match(passwordProblem('EMP-00001', 'emp-00001'), /same as the ID/);
  assert.match(passwordProblem('', 'EMP-0001'), /Enter a password/);
  assert.match(passwordProblem(12345678, 'EMP-0001'), /Enter a password/);
  // Characters, not bytes: eight emoji are eight characters.
  assert.equal(passwordProblem('🙂'.repeat(8), 'EMP-0001'), null);
  assert.match(passwordProblem('🙂'.repeat(7), 'EMP-0001'), /at least 8/);
});
