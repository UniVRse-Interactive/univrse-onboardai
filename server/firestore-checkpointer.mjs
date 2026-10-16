import { createHash } from 'node:crypto';
import {
  BaseCheckpointSaver,
  TASKS,
  WRITES_IDX_MAP,
  copyCheckpoint,
  getCheckpointId,
  maxChannelVersion,
} from '@langchain/langgraph-checkpoint';

// LangGraph checkpoints in Firestore, one thread per saved chat:
//
//   {root}/{threadId}/checkpoints/{checkpointKey}  ns, checkpointId, parentId, type, payload | parts, updated
//   {root}/{threadId}/writes/{writeKey}            ns, checkpointId, taskId, idx, channel, type, payload | parts, updated
//   {root}/{threadId}/chunks/{c|w}.{key}.{n}       data (bytes)
//
// The thread document itself is never written. A checkpoint's payload is its
// serialised checkpoint and metadata, framed into one byte string; a write's
// payload is its serialised value. Payloads up to INLINE_BYTES stay in the
// head document; larger ones are split into CHUNK_BYTES chunk documents and the
// head records how many (`parts`). Chunks are committed before (or with) their
// head, so a head that can be read always has its chunks. Firestore's limit is
// 1 MiB per document; queries use single-field equality only, so no composite
// index is needed.
export const INLINE_BYTES = 900 * 1024;
export const CHUNK_BYTES = 900 * 1024;
// Batches stay well below Firestore's 10 MiB request and 500-write limits, also
// with REST's base64 encoding of bytes.
const COMMIT_BYTES = 4 * 1024 * 1024;
const COMMIT_WRITES = 400;

function documentId(value, field) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('/') ||
    value === '.' ||
    value === '..' ||
    /^__.*__$/.test(value) ||
    Buffer.byteLength(value) > 1500
  )
    throw new Error(`Invalid ${field} for the Firestore checkpointer.`);
  return value;
}
const encode = (value) => encodeURIComponent(String(value)).replace(/\./g, '%2E');
const nsKey = (ns) => createHash('sha256').update(ns).digest('hex').slice(0, 24);
export const checkpointKey = (ns, checkpointId) =>
  (ns ? nsKey(ns) + '.' : '') + encode(checkpointId);
export const writeKey = (ns, checkpointId, taskId, idx) =>
  `${checkpointKey(ns, checkpointId)}.${encode(taskId)}.${idx}`;

function frame(first, second) {
  const bytes = Buffer.allocUnsafe(4 + first.length + second.length);
  bytes.writeUInt32BE(first.length, 0);
  bytes.set(first, 4);
  bytes.set(second, 4 + first.length);
  return bytes;
}
function unframe(bytes) {
  const length = bytes.readUInt32BE(0);
  return [bytes.subarray(4, 4 + length), bytes.subarray(4 + length)];
}
const asBuffer = (value) => (Buffer.isBuffer(value) ? value : Buffer.from(value));

export const setOperation = (ref, data, size = 2048) => ({ ref, data, size });
export const deleteOperation = (ref) => ({ ref, size: 64 });

// Commits operations in order, in as few batches as the limits allow.
export async function commitInBatches(db, operations) {
  let batch = db.batch(),
    count = 0,
    bytes = 0;
  for (const operation of operations) {
    if (count && (count >= COMMIT_WRITES || bytes + operation.size > COMMIT_BYTES)) {
      await batch.commit();
      batch = db.batch();
      count = bytes = 0;
    }
    if (operation.data === undefined) batch.delete(operation.ref);
    else batch.set(operation.ref, operation.data);
    count++;
    bytes += operation.size;
  }
  if (count) await batch.commit();
}

const chunkRefs = (chunks, prefix, parts = 0) =>
  Array.from({ length: parts }, (_, i) => chunks.doc(`${prefix}.${i}`));

function storeBytes(bytes, chunks, prefix) {
  if (bytes.length <= INLINE_BYTES)
    return { fields: { payload: Buffer.from(bytes), parts: 0 }, operations: [] };
  const parts = Math.ceil(bytes.length / CHUNK_BYTES);
  return {
    fields: { payload: null, parts },
    operations: chunkRefs(chunks, prefix, parts).map((ref, i) => {
      const data = Buffer.from(bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES));
      return setOperation(ref, { data }, data.length + 512);
    }),
  };
}

// items: [{ prefix, head }] -> one Buffer per item; all chunks in one batch get.
async function readPayloads(db, chunks, items) {
  const refs = items.flatMap(({ prefix, head }) => chunkRefs(chunks, prefix, head.parts));
  const found = new Map((refs.length ? await db.getAll(...refs) : []).map((s) => [s.id, s]));
  return items.map(({ prefix, head }) => {
    if (!head.parts) {
      if (head.payload == null) throw Object.assign(new Error('Missing payload'), { code: 15 });
      return asBuffer(head.payload);
    }
    return Buffer.concat(
      chunkRefs(chunks, prefix, head.parts).map((ref) => {
        const snapshot = found.get(ref.id);
        if (!snapshot?.exists) throw Object.assign(new Error('Missing chunk'), { code: 15 });
        return asBuffer(snapshot.data().data);
      }),
    );
  });
}

const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export class FirestoreSaver extends BaseCheckpointSaver {
  // firestore: a Firestore instance or an async function returning one.
  // call(operation, fn): optional wrapper adding a deadline and safe errors.
  constructor({ firestore, root = 'chatCheckpoints', call = (operation, fn) => fn() } = {}, serde) {
    super(serde);
    this.database = typeof firestore === 'function' ? firestore : async () => firestore;
    this.root = root;
    this.call = call;
  }

  async thread(threadId) {
    const db = await this.database();
    const base = db.collection(this.root).doc(threadId);
    return {
      db,
      checkpoints: base.collection('checkpoints'),
      writes: base.collection('writes'),
      chunks: base.collection('chunks'),
    };
  }

  async getTuple(config) {
    const threadId = config.configurable?.thread_id;
    const ns = config.configurable?.checkpoint_ns ?? '';
    const checkpointId = getCheckpointId(config);
    if (threadId === undefined) return undefined;
    documentId(threadId, 'thread_id');
    return this.call('read checkpoint', async () => {
      const t = await this.thread(threadId);
      let id = checkpointId;
      if (!id) {
        const heads = await t.checkpoints.where('ns', '==', ns).select('checkpointId').get();
        id = heads.docs
          .map((doc) => doc.data().checkpointId)
          .sort(byString)
          .at(-1);
        if (!id) return undefined;
      }
      const snapshot = await t.checkpoints.doc(checkpointKey(ns, id)).get();
      if (!snapshot.exists) return undefined;
      return this.tuple(t, threadId, snapshot, checkpointId ? config : undefined);
    });
  }

  async tuple(t, threadId, snapshot, config) {
    const head = snapshot.data();
    const [payload] = await readPayloads(t.db, t.chunks, [{ prefix: `c.${snapshot.id}`, head }]);
    const [checkpointBytes, metadataBytes] = unframe(payload);
    const checkpoint = await this.serde.loadsTyped(head.type, checkpointBytes);
    if (checkpoint.v < 4 && head.parentId)
      await this.migratePendingSends(t, checkpoint, head.ns, head.parentId);
    const at = (checkpointId) => ({
      configurable: { thread_id: threadId, checkpoint_ns: head.ns, checkpoint_id: checkpointId },
    });
    return {
      config: config ?? at(head.checkpointId),
      checkpoint,
      metadata: await this.serde.loadsTyped(head.type, metadataBytes),
      parentConfig: head.parentId ? at(head.parentId) : undefined,
      pendingWrites: await this.writesFor(t, head.ns, head.checkpointId),
    };
  }

  // Pending writes in (taskId, idx) order, like SqliteSaver's primary key.
  async writesFor(t, ns, checkpointId, channel) {
    const found = await t.writes.where('checkpointId', '==', checkpointId).get();
    const docs = found.docs
      .filter((doc) => doc.data().ns === ns && (!channel || doc.data().channel === channel))
      .sort((a, b) => byString(a.data().taskId, b.data().taskId) || a.data().idx - b.data().idx);
    const payloads = await readPayloads(
      t.db,
      t.chunks,
      docs.map((doc) => ({ prefix: `w.${doc.id}`, head: doc.data() })),
    );
    return Promise.all(
      docs.map(async (doc, i) => {
        const write = doc.data();
        return [write.taskId, write.channel, await this.serde.loadsTyped(write.type, payloads[i])];
      }),
    );
  }

  async migratePendingSends(t, checkpoint, ns, parentId) {
    const sends = await this.writesFor(t, ns, parentId, TASKS);
    checkpoint.channel_values ??= {};
    checkpoint.channel_values[TASKS] = sends.map(([, , value]) => value);
    checkpoint.channel_versions[TASKS] =
      Object.keys(checkpoint.channel_versions).length > 0
        ? maxChannelVersion(...Object.values(checkpoint.channel_versions))
        : this.getNextVersion(undefined);
  }

  // Newest first, like SqliteSaver. Unlike SqliteSaver, a thread_id is required
  // and listing across all threads throws: the app only reads one chat's state
  // (graph.invoke, getState, getStateHistory), and a cross-thread list would
  // need a collection-group index.
  async *list(config, options = {}) {
    const { limit, before, filter } = options;
    const threadId = config.configurable?.thread_id;
    if (!threadId) throw new Error('The Firestore checkpointer lists one thread at a time.');
    documentId(threadId, 'thread_id');
    const ns = config.configurable?.checkpoint_ns;
    const beforeId = before?.configurable?.checkpoint_id;
    const wanted = Object.entries(filter ?? {}).filter(([, value]) => value !== undefined);
    const heads = await this.call('list checkpoints', async () => {
      const t = await this.thread(threadId);
      const query = ns == null ? t.checkpoints : t.checkpoints.where('ns', '==', ns);
      const found = await query.select('checkpointId').get();
      return found.docs.map((doc) => ({ key: doc.id, checkpointId: doc.data().checkpointId }));
    });
    let remaining = limit ? parseInt(limit, 10) : Infinity;
    for (const head of heads
      .filter((h) => beforeId === undefined || h.checkpointId < beforeId)
      .sort((a, b) => byString(b.checkpointId, a.checkpointId) || byString(b.key, a.key))) {
      if (remaining <= 0) return;
      const tuple = await this.call('list checkpoints', async () => {
        const t = await this.thread(threadId);
        const snapshot = await t.checkpoints.doc(head.key).get();
        return snapshot.exists ? this.tuple(t, threadId, snapshot) : undefined;
      });
      if (!tuple) continue;
      if (
        !wanted.every(
          ([key, value]) => JSON.stringify(tuple.metadata?.[key]) === JSON.stringify(value),
        )
      )
        continue;
      remaining--;
      yield tuple;
    }
  }

  async put(config, checkpoint, metadata) {
    if (!config.configurable) throw new Error('Empty configuration supplied.');
    const threadId = config.configurable.thread_id;
    const ns = config.configurable.checkpoint_ns ?? '';
    const parentId = config.configurable.checkpoint_id;
    if (!threadId) throw new Error('Missing "thread_id" field in passed "config.configurable".');
    documentId(threadId, 'thread_id');
    const key = documentId(checkpointKey(ns, checkpoint.id), 'checkpoint id');
    const [[type, serialised], [metadataType, serialisedMetadata]] = await Promise.all([
      this.serde.dumpsTyped(copyCheckpoint(checkpoint)),
      this.serde.dumpsTyped(metadata),
    ]);
    if (type !== metadataType)
      throw new Error('Failed to serialise checkpoint and metadata to the same type.');
    await this.call('save checkpoint', async () => {
      const t = await this.thread(threadId);
      const stored = storeBytes(frame(serialised, serialisedMetadata), t.chunks, `c.${key}`);
      await commitInBatches(t.db, [
        ...stored.operations,
        setOperation(
          t.checkpoints.doc(key),
          {
            ns,
            checkpointId: checkpoint.id,
            parentId: parentId ?? null,
            type,
            ...stored.fields,
            updated: Date.now(),
          },
          (stored.fields.payload?.length || 0) + 2048,
        ),
      ]);
    });
    return {
      configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: checkpoint.id },
    };
  }

  // Like SqliteSaver: special writes (errors, interrupts) replace; regular
  // writes keep the first value stored for a (task, index).
  async putWrites(config, writes, taskId) {
    if (!config.configurable) throw new Error('Empty configuration supplied.');
    const threadId = config.configurable.thread_id;
    const checkpointId = config.configurable.checkpoint_id;
    const ns = config.configurable.checkpoint_ns ?? '';
    if (!threadId) throw new Error('Missing thread_id field in config.configurable.');
    if (!checkpointId) throw new Error('Missing checkpoint_id field in config.configurable.');
    documentId(threadId, 'thread_id');
    if (!writes.length) return;
    const replace = writes.every(([channel]) => channel in WRITES_IDX_MAP);
    const rows = new Map();
    writes.forEach(([channel, value], i) => {
      const idx = WRITES_IDX_MAP[channel] ?? i;
      const key = documentId(writeKey(ns, checkpointId, taskId, idx), 'write key');
      if (replace || !rows.has(key)) rows.set(key, { channel, value, idx });
    });
    const serialised = await Promise.all(
      [...rows].map(async ([key, row]) => {
        const [type, bytes] = await this.serde.dumpsTyped(row.value);
        return { key, type, bytes, ...row };
      }),
    );
    await this.call('save checkpoint writes', async () => {
      const t = await this.thread(threadId);
      const refs = serialised.map((row) => t.writes.doc(row.key));
      const existing = replace ? [] : await t.db.getAll(...refs);
      const operations = [];
      serialised.forEach((row, i) => {
        if (existing[i]?.exists) return;
        const stored = storeBytes(row.bytes, t.chunks, `w.${row.key}`);
        operations.push(
          ...stored.operations,
          setOperation(
            refs[i],
            {
              ns,
              checkpointId,
              taskId,
              idx: row.idx,
              channel: row.channel,
              type: row.type,
              ...stored.fields,
              updated: Date.now(),
            },
            (stored.fields.payload?.length || 0) + 2048,
          ),
        );
      });
      await commitInBatches(t.db, operations);
    });
  }

  async deleteThread(threadId) {
    documentId(threadId, 'thread_id');
    await this.call('delete checkpoints', async () => {
      const t = await this.thread(threadId);
      const found = await Promise.all(
        [t.checkpoints, t.writes, t.chunks].map((collection) => collection.select().get()),
      );
      await commitInBatches(
        t.db,
        found.flatMap((snapshot) => snapshot.docs.map((doc) => deleteOperation(doc.ref))),
      );
    });
  }

  // Keeps the newest `keep` checkpoints of a thread and their writes, as the
  // SQLite store does after each saved answer. Graph history is not exposed.
  async prune(threadId, keep = 2) {
    documentId(threadId, 'thread_id');
    await this.call('prune checkpoints', async () => {
      const t = await this.thread(threadId);
      const [heads, writes] = await Promise.all([
        t.checkpoints.select('checkpointId', 'parts').get(),
        t.writes.select('checkpointId', 'parts').get(),
      ]);
      const ids = [...new Set(heads.docs.map((doc) => doc.data().checkpointId))]
        .sort(byString)
        .reverse();
      if (ids.length < keep) return;
      const kept = new Set(ids.slice(0, keep));
      const stale = (prefix) => (doc) =>
        kept.has(doc.data().checkpointId)
          ? []
          : [
              deleteOperation(doc.ref),
              ...chunkRefs(t.chunks, `${prefix}.${doc.id}`, doc.data().parts).map(deleteOperation),
            ];
      await commitInBatches(t.db, [
        ...heads.docs.flatMap(stale('c')),
        ...writes.docs.flatMap(stale('w')),
      ]);
    });
  }
}
