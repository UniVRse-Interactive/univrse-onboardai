// Issue #70: a failed checkpoint save during a chat turn must fail only that
// turn. LangGraph saves checkpoints (put) and node writes (putWrites) in the
// background while later nodes run; before the fix, a save that failed while a
// node was still running was an unhandled rejection and Node exited.
//
// The HTTP tests fail checkpoint saves in the fake Firestore during a real
// gemini-chat turn (fake models), hold the answer node until a save has failed
// and the event loop has turned (when Node reports unhandled rejections), and
// check that the turn answers the storage error, nothing is left unhandled,
// the server keeps serving and the next turn works once storage heals.
// Run alone with `node --test --unhandled-rejections=strict` as well.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setImmediate as nextTurn, setTimeout as sleep } from 'node:timers/promises';
import { storageError } from '../../server/chat-errors.mjs';
import { containCheckpointWrites } from '../../server/checkpoint-writes.mjs';
import { fakeModels, startAccountsApp } from './account-harness.mjs';

const unhandled = [];
process.on('unhandledRejection', (reason) => unhandled.push(reason));

const isSaveFailure = (line) => line.includes('"operation":"save checkpoint');
const ask = (browser, conversationId, question) =>
  browser.post('/api/chat', {
    question,
    taskId: 'company-resources',
    conversationId,
    requestId: randomUUID(),
  });

// fault: the FakeFirestore fail() arguments for the checkpoint saves.
async function failSavesDuringTurn({ fault, status, code, reason, chatStorageTimeoutMs }) {
  let app,
    holding = false,
    since = 0;
  const models = () => ({
    ...fakeModels(),
    answer: {
      invoke: async () => {
        // A slow Gemini answer: still running when a checkpoint save fails.
        while (holding && !app.logs.slice(since).some(isSaveFailure)) await sleep(5);
        await nextTurn();
        return { answer: 'Business casual clothing.', citations: [1] };
      },
    },
  });
  app = await startAccountsApp({ mode: 'gemini-chat', models, chatStorageTimeoutMs });
  try {
    const hr = await app.hrBrowser();
    const { browser } = await app.readyEmployee(hr);
    const chat = (await browser.post('/api/conversations')).body;
    unhandled.length = 0;
    since = app.logs.length;
    holding = true;
    app.firestore.fail(...fault);
    const failed = await ask(browser, chat.id, 'PRIVATE-QUESTION What should I wear?');
    await nextTurn();
    assert.deepEqual(unhandled, [], 'no unhandled rejection');
    assert.deepEqual([failed.status, failed.body.code], [status, code]);
    assert.ok(!/PRIVATE|Injected|chatCheckpoints/.test(failed.text));
    const saveFailures = app.logs.slice(since).filter(isSaveFailure);
    assert.ok(saveFailures.length > 0);
    for (const line of saveFailures)
      assert.match(
        line,
        new RegExp(
          `^Firestore request failed: \\{"operation":"save checkpoint( writes)?","code":"${code}","reason":"${reason}"\\}$`,
        ),
      );

    // The server keeps serving; the failed question was not saved and the chat is free.
    const opened = await browser.get(`/api/conversations/${chat.id}`);
    assert.equal(opened.status, 200);
    assert.deepEqual(opened.body.messages, []);
    holding = false;
    app.firestore.heal();
    const answered = await ask(browser, chat.id, 'What should I wear?');
    assert.equal(answered.status, 200, answered.text);
    assert.equal(answered.body.answer, 'Business casual clothing.');
    const saved = await browser.get(`/api/conversations/${chat.id}`);
    assert.deepEqual(
      saved.body.messages.map((m) => [m.role, m.text]),
      [
        ['user', 'What should I wear?'],
        ['assistant', 'Business casual clothing.'],
      ],
    );
    assert.ok(app.firestore.paths(`chatCheckpoints/${chat.id}/checkpoints/`).length > 0);
    await nextTurn();
    assert.deepEqual(unhandled, [], 'no unhandled rejection');
  } finally {
    await app.close();
  }
}

test('a failed save of node writes (putWrites) fails only that turn with the storage error', async () => {
  await failSavesDuringTurn({
    fault: [4, { only: ['commit'], match: /\/writes\//, times: Infinity }],
    status: 504,
    code: 'STORAGE_TIMEOUT',
    reason: 'DEADLINE_EXCEEDED',
  });
});

test('a failed checkpoint save (put) fails only that turn with the storage error', async () => {
  await failSavesDuringTurn({
    fault: [14, { only: ['commit'], match: /\/checkpoints\//, times: Infinity }],
    status: 503,
    code: 'STORAGE_UNAVAILABLE',
    reason: 'UNAVAILABLE',
  });
});

test('a checkpoint save that runs out of time while the answer is still running fails only that turn', async () => {
  // The crash QA saw: the 10-second limit (here 200 ms) expiring mid-answer.
  await failSavesDuringTurn({
    fault: [0, { only: ['commit'], match: /\/writes\//, hang: true, times: Infinity }],
    chatStorageTimeoutMs: 200,
    status: 504,
    code: 'STORAGE_TIMEOUT',
    reason: 'TIMEOUT',
  });
});

test('containCheckpointWrites: saves never reject, a turn keeps its first failure and skips later saves', async () => {
  const calls = [],
    logs = [];
  let failure = null,
    release = null;
  const inner = {
    getTuple: async (config) => ({ config }),
    put: async (config, checkpoint) => {
      calls.push(['put', checkpoint.id]);
      if (failure) throw failure;
      return { configurable: { ...config.configurable, checkpoint_id: checkpoint.id } };
    },
    putWrites: async (config, writes, taskId) => {
      calls.push(['putWrites', taskId]);
      if (release) await release;
      if (failure) throw failure;
    },
  };
  const checkpoints = containCheckpointWrites(inner, { log: (line) => logs.push(line) });
  const saver = checkpoints.saver;
  const at = (thread) => ({ configurable: { thread_id: thread, checkpoint_ns: '' } });

  // Every other method is the wrapped saver's own.
  assert.deepEqual(await saver.getTuple(at('a')), { config: at('a') });
  // Successful saves pass through.
  assert.deepEqual(await saver.put(at('a'), { id: 'c1' }, {}, {}), {
    configurable: { thread_id: 'a', checkpoint_ns: '', checkpoint_id: 'c1' },
  });

  // In a turn: the first failure is kept; saves that start after it are skipped.
  const turn = checkpoints.begin('a');
  failure = storageError('STORAGE_TIMEOUT');
  assert.equal(await saver.putWrites(at('a'), [['x', 1]], 'task-1'), undefined);
  failure = storageError('STORAGE_UNAVAILABLE');
  assert.equal(await saver.put(at('a'), { id: 'c2' }, {}, {}), undefined);
  assert.equal(await saver.putWrites(at('a'), [['x', 2]], 'task-2'), undefined);
  assert.deepEqual(calls.slice(-1), [['putWrites', 'task-1']]);
  // Another chat's turn is unaffected.
  failure = null;
  const other = checkpoints.begin('b');
  await saver.put(at('b'), { id: 'b1' }, {}, {});
  assert.equal(other.end(), null);
  const kept = turn.end();
  assert.equal(kept.code, 'STORAGE_TIMEOUT');
  assert.deepEqual(logs, []);

  // A save still running when its turn ends (a run cut off by its abort
  // signal) is logged and dropped, never blamed on the chat's next turn.
  let open;
  release = new Promise((resolve) => (open = resolve));
  const late = checkpoints.begin('a');
  const pending = saver.putWrites(at('a'), [['x', 3]], 'task-3');
  await nextTurn();
  assert.equal(late.end(), null);
  const next = checkpoints.begin('a');
  failure = storageError('STORAGE_TIMEOUT');
  open();
  assert.equal(await pending, undefined);
  failure = null;
  release = null;
  await saver.put(at('a'), { id: 'c3' }, {}, {});
  assert.equal(next.end(), null);
  // Outside any turn a failure is logged and dropped too.
  failure = Object.assign(new Error('SQLITE_FULL: private path /tmp/x'), { code: 'SQLITE_FULL' });
  assert.equal(await saver.put(at('c'), { id: 'c4' }, {}, {}), undefined);
  assert.deepEqual(logs, [
    'Chat checkpoint save dropped after its answer ended: {"name":"ChatError","code":"STORAGE_TIMEOUT"}',
    'Chat checkpoint save dropped after its answer ended: {"name":"Error","code":"SQLITE_FULL"}',
  ]);
  assert.deepEqual(unhandled, []);
});
