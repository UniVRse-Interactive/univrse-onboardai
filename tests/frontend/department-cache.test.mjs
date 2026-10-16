import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDepartmentCache } from '../../src/access/department-cache.mjs';

test('one request is shared until the cache is invalidated', async () => {
  let calls = 0;
  const cache = createDepartmentCache(async () => ({ departments: [{ id: String(++calls) }] }));
  const [a, b] = await Promise.all([cache.get(), cache.get()]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  const seen = [];
  cache.subscribe((v) => seen.push(v));
  cache.invalidate();
  assert.deepEqual(seen, [1]);
  assert.deepEqual(await cache.get(), [{ id: '2' }]);
});

test('a failed load is retried and reset is silent', async () => {
  let calls = 0;
  const cache = createDepartmentCache(async () => {
    if (++calls === 1) throw new Error('down');
    return { departments: [] };
  });
  await assert.rejects(cache.get(), /down/);
  assert.deepEqual(await cache.get(), []);
  const seen = [];
  cache.subscribe((v) => seen.push(v));
  cache.reset();
  assert.deepEqual(seen, []);
  await cache.get();
  assert.equal(calls, 3);
});

test('a bad payload gives an empty list', async () => {
  const cache = createDepartmentCache(async () => ({}));
  assert.deepEqual(await cache.get(), []);
});
