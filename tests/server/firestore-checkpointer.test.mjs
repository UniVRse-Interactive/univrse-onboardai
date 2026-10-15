import test from 'node:test';
import assert from 'node:assert/strict';
import { ERROR, INTERRUPT, emptyCheckpoint } from '@langchain/langgraph-checkpoint';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { CHUNK_BYTES, FirestoreSaver } from '../../server/firestore-checkpointer.mjs';
import { createStorageCall } from '../../server/firestore-client.mjs';
import { FakeFirestore, MAX_DOCUMENT_BYTES, documentSize } from './fake-firestore.mjs';

const id = (n) => `00000000-0000-6000-8000-${String(n).padStart(12, '0')}`;
const thread = '11111111-2222-4333-8444-555555555555';
const config = (checkpointId, ns = '') => ({
  configurable: { thread_id: thread, checkpoint_ns: ns, checkpoint_id: checkpointId },
});
function checkpoint(n, values) {
  return {
    ...emptyCheckpoint(),
    id: id(n),
    ts: `2026-10-15T00:00:0${n}.000Z`,
    channel_values: values,
    channel_versions: Object.fromEntries(Object.keys(values).map((k) => [k, n])),
  };
}
async function collect(iterator) {
  const out = [];
  for await (const item of iterator) out.push(item);
  return out;
}

// The same sequence of calls the graph makes, run against SqliteSaver and the
// Firestore saver; every read must agree.
async function scenario(saver) {
  const results = {};
  const c1 = await saver.put(
    { configurable: { thread_id: thread, checkpoint_ns: '' } },
    checkpoint(1, { messages: ['hello'], summary: '' }),
    { source: 'input', step: -1, parents: {} },
  );
  await saver.putWrites(
    c1,
    [
      ['messages', ['hello', 'answer']],
      ['result', { answer: 'answer', passages: [] }],
    ],
    'task-a',
  );
  // A regular write for the same task and index keeps its first value.
  await saver.putWrites(c1, [['messages', ['changed']]], 'task-a');
  await saver.putWrites(c1, [[ERROR, { message: 'first' }]], 'task-b');
  // Special writes (errors, interrupts) replace.
  await saver.putWrites(c1, [[ERROR, { message: 'second' }]], 'task-b');
  const c2 = await saver.put(c1, checkpoint(2, { messages: ['hello', 'answer'], summary: 'Sam' }), {
    source: 'loop',
    step: 0,
    parents: {},
  });
  await saver.put(
    { configurable: { thread_id: thread, checkpoint_ns: 'child:1' } },
    checkpoint(3, { inner: true }),
    { source: 'loop', step: 1, parents: { '': id(2) } },
  );
  await saver.putWrites(config(id(2)), [[INTERRUPT, { value: 'wait' }]], 'task-c');
  results.c2 = c2;
  results.latest = await saver.getTuple({ configurable: { thread_id: thread } });
  results.first = await saver.getTuple(config(id(1)));
  results.child = await saver.getTuple({
    configurable: { thread_id: thread, checkpoint_ns: 'child:1' },
  });
  results.missing = await saver.getTuple(config(id(9)));
  results.all = await collect(saver.list({ configurable: { thread_id: thread } }));
  results.rootOnly = await collect(
    saver.list({ configurable: { thread_id: thread, checkpoint_ns: '' } }, { limit: 1 }),
  );
  results.before = await collect(
    saver.list({ configurable: { thread_id: thread } }, { before: config(id(2)) }),
  );
  results.filtered = await collect(
    saver.list({ configurable: { thread_id: thread } }, { filter: { source: 'input' } }),
  );
  results.other = await saver.getTuple({ configurable: { thread_id: thread.replace('1', '9') } });
  await saver.deleteThread(thread);
  results.deleted = await saver.getTuple({ configurable: { thread_id: thread } });
  results.deletedList = await collect(saver.list({ configurable: { thread_id: thread } }));
  return results;
}

test('the Firestore checkpointer answers get, list, put, putWrites and deleteThread like SqliteSaver', async () => {
  const sqlite = SqliteSaver.fromConnString(':memory:');
  const fake = new FakeFirestore();
  try {
    const expected = await scenario(sqlite);
    const actual = await scenario(new FirestoreSaver({ firestore: fake }));
    assert.deepEqual(actual, expected);
    // Sanity checks on what both returned.
    assert.equal(expected.latest.checkpoint.id, id(2));
    assert.equal(expected.latest.parentConfig.configurable.checkpoint_id, id(1));
    assert.deepEqual(expected.latest.pendingWrites, [['task-c', INTERRUPT, { value: 'wait' }]]);
    assert.deepEqual(expected.first.pendingWrites, [
      ['task-a', 'messages', ['hello', 'answer']],
      ['task-a', 'result', { answer: 'answer', passages: [] }],
      ['task-b', ERROR, { message: 'second' }],
    ]);
    assert.deepEqual(
      expected.all.map((t) => t.checkpoint.id),
      [id(3), id(2), id(1)],
    );
    assert.equal(expected.deleted, undefined);
    assert.deepEqual(expected.deletedList, []);
    assert.deepEqual(fake.paths(), []);
  } finally {
    sqlite.db.close();
  }
});

test('checkpoints and writes above 1 MiB are split into chunk documents and read back intact', async () => {
  const fake = new FakeFirestore();
  const saver = new FirestoreSaver({ firestore: fake });
  // Mixed one-, two- and three-byte characters, as real chats can contain.
  const big = 'Plain text, café, 日本語 '.repeat(120000);
  const c1 = await saver.put(
    { configurable: { thread_id: thread, checkpoint_ns: '' } },
    checkpoint(1, { messages: [big], summary: '' }),
    { source: 'input', step: -1, parents: {} },
  );
  await saver.putWrites(c1, [['messages', [big, 'answer']]], 'task-a');
  const heads = fake.paths(`chatCheckpoints/${thread}/checkpoints/`);
  const chunks = fake.paths(`chatCheckpoints/${thread}/chunks/`);
  assert.equal(heads.length, 1);
  const parts = fake.read(heads[0]).parts;
  assert.ok(parts >= 3, `expected the checkpoint in several chunks, got ${parts}`);
  assert.equal(fake.read(heads[0]).payload, null);
  assert.ok(chunks.some((path) => path.includes('/chunks/w.')));
  for (const path of fake.paths())
    assert.ok(documentSize(path, fake.read(path)) <= MAX_DOCUMENT_BYTES, path);
  assert.ok(fake.read(chunks[0]).data.length <= CHUNK_BYTES);
  const tuple = await saver.getTuple({ configurable: { thread_id: thread } });
  assert.equal(tuple.checkpoint.channel_values.messages[0], big);
  assert.equal(tuple.pendingWrites[0][2][0], big);
  // Pruning a superseded checkpoint removes its chunks too.
  const c2 = await saver.put(c1, checkpoint(2, { messages: ['small'] }), { source: 'loop' });
  await saver.put(c2, checkpoint(3, { messages: ['small'] }), { source: 'loop' });
  await saver.prune(thread, 2);
  assert.deepEqual(
    fake.paths(`chatCheckpoints/${thread}/`).map((p) => p.split('/').slice(2).join('/')),
    [`checkpoints/${id(2)}`, `checkpoints/${id(3)}`],
  );
  await saver.deleteThread(thread);
  assert.deepEqual(fake.paths(), []);
});

test('a LangGraph graph keeps its state across invocations and new saver instances', async () => {
  const fake = new FakeFirestore();
  const State = Annotation.Root({
    count: Annotation({ reducer: (a, b) => a + b, default: () => 0 }),
    note: Annotation(),
  });
  const build = (saver) =>
    new StateGraph(State)
      .addNode('step', async (state) => ({ count: 1, note: `seen ${state.count + 1}` }))
      .addEdge(START, 'step')
      .addEdge('step', END)
      .compile({ checkpointer: saver });
  const run = { configurable: { thread_id: thread } };
  await build(new FirestoreSaver({ firestore: fake })).invoke({ count: 0 }, run);
  const graph = build(new FirestoreSaver({ firestore: fake.connect() }));
  const result = await graph.invoke({ count: 0 }, run);
  assert.equal(result.count, 2);
  assert.equal(result.note, 'seen 2');
  assert.equal((await graph.getState(run)).values.count, 2);
  const history = [];
  for await (const state of graph.getStateHistory(run)) history.push(state);
  assert.ok(history.length >= 4);
});

test('checkpointer failures become fixed storage errors without private details', async () => {
  const fake = new FakeFirestore(),
    logs = [];
  const saver = new FirestoreSaver({
    firestore: fake,
    call: createStorageCall({ timeoutMs: 30, log: (line) => logs.push(line) }),
  });
  fake.fail(7, { only: ['commit'] });
  await assert.rejects(
    saver.put({ configurable: { thread_id: thread } }, checkpoint(1, { a: 1 }), {}),
    (error) => error.code === 'STORAGE_ACCESS_DENIED' && error.status === 503,
  );
  fake.fail(0, { hang: true, only: ['query'] });
  await assert.rejects(
    saver.getTuple({ configurable: { thread_id: thread } }),
    (error) => error.code === 'STORAGE_TIMEOUT' && error.status === 504,
  );
  assert.deepEqual(logs, [
    'Firestore request failed: {"operation":"save checkpoint","code":"STORAGE_ACCESS_DENIED","reason":"PERMISSION_DENIED"}',
    'Firestore request failed: {"operation":"read checkpoint","code":"STORAGE_TIMEOUT","reason":"TIMEOUT"}',
  ]);
  await assert.rejects(saver.list({ configurable: {} }).next(), /one thread/);
  await assert.rejects(
    saver.put({ configurable: { thread_id: 'a/b' } }, checkpoint(1, { a: 1 }), {}),
    /Invalid thread_id/,
  );
});
