// In-memory stand-in for the part of the @google-cloud/firestore client that the
// saved-chat store and checkpointer use. No network, no emulator. It enforces
// the Firestore rules the store depends on: 1 MiB documents, no nested arrays,
// reads before writes in transactions, serialisable transactions (documents
// read in a transaction are locked until it ends, as with the server SDK, and
// any other change is detected and retried), 500 writes per commit, and
// single-field queries only (anything else would need a composite index).
// Tests can inject failures, delays and stalls.

export const MAX_DOCUMENT_BYTES = 1048576;
const MAX_FIELD_BYTES = 1048487;

const firestoreError = (code, message) => Object.assign(new Error(message), { code });

function validSegment(segment) {
  return segment && segment !== '.' && segment !== '..' && !/^__.*__$/.test(segment);
}
function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
// Copies a value as Firestore would store it: undefined fields are skipped
// (ignoreUndefinedProperties), bytes come back as Buffer.
function clone(value, inArray = false) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    if (typeof value === 'string' && Buffer.byteLength(value) > MAX_FIELD_BYTES)
      throw firestoreError(3, 'string field too large');
    return value;
  }
  if (value instanceof Uint8Array) {
    if (value.length > MAX_FIELD_BYTES) throw firestoreError(3, 'bytes field too large');
    return Buffer.from(value);
  }
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) {
    if (inArray) throw firestoreError(3, 'nested arrays are not supported');
    return value.filter((item) => item !== undefined).map((item) => clone(item, true));
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (!key) throw firestoreError(3, 'empty field name');
      if (item !== undefined) out[key] = clone(item);
    }
    return out;
  }
  throw firestoreError(3, `unsupported value ${typeof value}`);
}
function valueSize(value) {
  if (value === null || typeof value === 'boolean') return 1;
  if (typeof value === 'number' || value instanceof Date) return 8;
  if (typeof value === 'string') return Buffer.byteLength(value) + 1;
  if (value instanceof Uint8Array) return value.length;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + valueSize(item), 0);
  return Object.entries(value).reduce(
    (sum, [key, item]) => sum + Buffer.byteLength(key) + 1 + valueSize(item),
    0,
  );
}
export function documentSize(path, data) {
  const name = path.split('/').reduce((sum, s) => sum + Buffer.byteLength(s) + 1, 16);
  return name + valueSize(data) + 32;
}
function compare(a, b) {
  if (typeof a !== typeof b) return NaN;
  return a < b ? -1 : a > b ? 1 : 0;
}
const same = (a, b) =>
  a === b || (typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b));
const matches = {
  '==': (a, b) => same(a, b),
  '<': (a, b) => compare(a, b) < 0,
  '<=': (a, b) => compare(a, b) <= 0,
  '>': (a, b) => compare(a, b) > 0,
  '>=': (a, b) => compare(a, b) >= 0,
};

class Snapshot {
  constructor(ref, data, fields) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = data !== undefined;
    this._data = data;
    this._fields = fields;
  }
  data() {
    if (!this.exists) return undefined;
    const data = clone(this._data);
    if (!this._fields) return data;
    return Object.fromEntries(this._fields.filter((f) => f in data).map((f) => [f, data[f]]));
  }
}

class DocumentReference {
  constructor(db, path) {
    this.firestore = db;
    this.path = path;
    this.id = path.split('/').at(-1);
  }
  get parent() {
    return new CollectionReference(this.firestore, this.path.split('/').slice(0, -1).join('/'));
  }
  collection(name) {
    return this.firestore.collection(`${this.path}/${name}`);
  }
  async get() {
    await this.firestore._gate('get');
    return this.firestore._snapshot(this);
  }
  async create(data) {
    await this.firestore._gate('create');
    this.firestore._apply([{ type: 'create', ref: this, data }]);
  }
  async set(data) {
    await this.firestore._gate('set');
    this.firestore._apply([{ type: 'set', ref: this, data }]);
  }
  async update(data) {
    await this.firestore._gate('update');
    this.firestore._apply([{ type: 'update', ref: this, data }]);
  }
  async delete() {
    await this.firestore._gate('delete');
    this.firestore._apply([{ type: 'delete', ref: this }]);
  }
}

class Query {
  constructor(db, path, { filters = [], fields = null, limit = null } = {}) {
    this.firestore = db;
    this.path = path;
    this._filters = filters;
    this._fields = fields;
    this._limit = limit;
  }
  where(field, op, value) {
    if (!(op in matches)) throw new Error(`fake: operator ${op} is not supported`);
    if (value === undefined) throw firestoreError(3, 'undefined filter value');
    if (this._filters.some((filter) => filter.field !== field))
      throw new Error('fake: filters on two fields need a composite index');
    return new Query(this.firestore, this.path, {
      filters: [...this._filters, { field, op, value }],
      fields: this._fields,
      limit: this._limit,
    });
  }
  select(...fields) {
    return new Query(this.firestore, this.path, {
      filters: this._filters,
      fields,
      limit: this._limit,
    });
  }
  limit(limit) {
    return new Query(this.firestore, this.path, {
      filters: this._filters,
      fields: this._fields,
      limit,
    });
  }
  async get() {
    await this.firestore._gate('query');
    return this.firestore._query(this);
  }
}

class CollectionReference extends Query {
  constructor(db, path) {
    super(db, path);
    this.id = path.split('/').at(-1);
  }
  doc(relative = crypto.randomUUID()) {
    const path = `${this.path}/${relative}`;
    const segments = path.split('/');
    if (segments.length % 2 !== 0 || !segments.every(validSegment))
      throw new Error('fake: invalid document path');
    return new DocumentReference(this.firestore, path);
  }
}

class WriteBatch {
  constructor(db) {
    this.firestore = db;
    this.operations = [];
  }
  create(ref, data) {
    this.operations.push({ type: 'create', ref, data });
    return this;
  }
  set(ref, data) {
    this.operations.push({ type: 'set', ref, data });
    return this;
  }
  update(ref, data) {
    this.operations.push({ type: 'update', ref, data });
    return this;
  }
  delete(ref) {
    this.operations.push({ type: 'delete', ref });
    return this;
  }
  async commit() {
    await this.firestore._gate('commit');
    this.firestore._apply(this.operations);
  }
}

class Transaction extends WriteBatch {
  constructor(db) {
    super(db);
    this.reads = new Map();
    this.queries = [];
    this.held = new Set();
  }
  _read() {
    if (this.operations.length)
      throw new Error('Firestore transactions require all reads to be executed before all writes.');
  }
  // Waits for another transaction holding the document, then holds it.
  async _lock(path) {
    const locks = this.firestore.store.locks;
    while (locks.has(path) && locks.get(path).owner !== this) await locks.get(path).released;
    if (locks.has(path)) return;
    let resolve;
    const released = new Promise((done) => (resolve = done));
    locks.set(path, { owner: this, released, resolve });
    this.held.add(path);
  }
  _unlock() {
    const locks = this.firestore.store.locks;
    for (const path of this.held) {
      const lock = locks.get(path);
      if (lock?.owner !== this) continue;
      locks.delete(path);
      lock.resolve();
    }
    this.held.clear();
  }
  async get(target) {
    this._read();
    if (target instanceof DocumentReference) {
      await this.firestore._gate('get');
      await this._lock(target.path);
      this.reads.set(target.path, this.firestore._version(target.path));
      return this.firestore._snapshot(target);
    }
    await this.firestore._gate('query');
    for (const doc of this.firestore._query(target.select()).docs) await this._lock(doc.ref.path);
    const snapshot = this.firestore._query(target);
    this.queries.push({ query: target, signature: this.firestore._signature(target) });
    return snapshot;
  }
  async getAll(...refs) {
    this._read();
    await this.firestore._gate('getAll');
    for (const ref of refs) await this._lock(ref.path);
    for (const ref of refs) this.reads.set(ref.path, this.firestore._version(ref.path));
    return refs.map((ref) => this.firestore._snapshot(ref));
  }
}

class Store {
  constructor() {
    this.documents = new Map();
    this.versions = new Map();
    this.locks = new Map();
    this.clock = 0;
  }
}

export class FakeFirestore {
  constructor(store = new Store()) {
    this.store = store;
    this.faults = [];
    this.calls = {};
    this.terminated = false;
  }
  // A second client over the same data, like another server instance.
  connect() {
    return new FakeFirestore(this.store);
  }
  collection(path) {
    if (!path.split('/').every(validSegment) || path.split('/').length % 2 !== 1)
      throw new Error('fake: invalid collection path');
    return new CollectionReference(this, path);
  }
  batch() {
    return new WriteBatch(this);
  }
  async getAll(...refs) {
    if (!refs.length) throw new Error('fake: getAll needs at least one document');
    await this._gate('getAll');
    return refs.map((ref) => this._snapshot(ref));
  }
  async runTransaction(update) {
    await this._gate('transaction');
    for (let attempt = 0; attempt < 5; attempt++) {
      const tx = new Transaction(this);
      try {
        const result = await update(tx);
        // Faults here model a slow or failed commit while the locks are held.
        await this._gate('transaction-commit');
        const unchanged =
          [...tx.reads].every(([path, version]) => this._version(path) === version) &&
          tx.queries.every(({ query, signature }) => this._signature(query) === signature);
        if (unchanged) {
          this._apply(tx.operations);
          return result;
        }
      } finally {
        tx._unlock();
      }
    }
    throw firestoreError(10, 'Transaction contention');
  }
  async terminate() {
    this.terminated = true;
  }

  // Test controls ---------------------------------------------------------
  // Makes the next `times` operations (optionally only some kinds) fail with
  // this gRPC code, never answer (hang), or succeed after delayMs.
  fail(code, { times = 1, only = null, hang = false, delayMs = 0 } = {}) {
    this.faults.push({ code, times, only, hang, delayMs });
  }
  heal() {
    this.faults = [];
  }
  paths(prefix = '') {
    return [...this.store.documents.keys()].filter((path) => path.startsWith(prefix)).sort();
  }
  read(path) {
    const data = this.store.documents.get(path);
    return data === undefined ? undefined : clone(data);
  }
  write(path, data) {
    const [collection, ...rest] = path.split('/');
    this._apply([{ type: 'set', ref: this.collection(collection).doc(rest.join('/')), data }]);
  }

  // Internals -------------------------------------------------------------
  async _gate(operation) {
    this.calls[operation] = (this.calls[operation] || 0) + 1;
    if (this.terminated) throw new Error('The client has already been terminated.');
    const fault = this.faults.find((f) => f.times > 0 && (!f.only || f.only.includes(operation)));
    if (!fault) return;
    fault.times--;
    if (fault.hang) return new Promise(() => {});
    if (fault.delayMs) return new Promise((resolve) => setTimeout(resolve, fault.delayMs));
    throw firestoreError(fault.code, 'Injected failure with private chat text and a document path');
  }
  _version(path) {
    return this.store.versions.get(path) || 0;
  }
  _snapshot(ref, fields = null) {
    return new Snapshot(ref, this.store.documents.get(ref.path), fields);
  }
  _children(path) {
    const depth = path.split('/').length + 1;
    return [...this.store.documents.keys()]
      .filter((p) => p.startsWith(path + '/') && p.split('/').length === depth)
      .sort();
  }
  _query(query) {
    let paths = this._children(query.path).filter((path) =>
      query._filters.every(({ field, op, value }) => {
        const data = this.store.documents.get(path);
        return field in data && matches[op](data[field], value);
      }),
    );
    if (query._limit != null) paths = paths.slice(0, query._limit);
    const docs = paths.map(
      (path) =>
        new Snapshot(
          new DocumentReference(this, path),
          this.store.documents.get(path),
          query._fields,
        ),
    );
    return { docs, empty: !docs.length, size: docs.length, forEach: (fn) => docs.forEach(fn) };
  }
  _signature(query) {
    return JSON.stringify(
      this._query(query.select()).docs.map((doc) => [doc.ref.path, this._version(doc.ref.path)]),
    );
  }
  // Applies a commit atomically, or rejects it without changes.
  _apply(operations) {
    if (operations.length > 500) throw firestoreError(3, 'too many writes in one commit');
    const next = new Map();
    const current = (path) => (next.has(path) ? next.get(path) : this.store.documents.get(path));
    for (const { type, ref, data } of operations) {
      const existing = current(ref.path);
      if (type === 'delete') next.set(ref.path, undefined);
      else if (type === 'create' && existing !== undefined)
        throw firestoreError(6, 'Document already exists');
      else if (type === 'update') {
        if (existing === undefined) throw firestoreError(5, 'No document to update');
        if (Object.keys(data).some((key) => key.includes('.')))
          throw new Error('fake: field paths in update() are not supported');
        next.set(ref.path, { ...existing, ...clone(data) });
      } else next.set(ref.path, clone(data));
      const written = next.get(ref.path);
      if (written !== undefined && documentSize(ref.path, written) > MAX_DOCUMENT_BYTES)
        throw firestoreError(3, 'Document exceeds the 1 MiB limit');
    }
    for (const [path, data] of next) {
      if (data === undefined) this.store.documents.delete(path);
      else this.store.documents.set(path, data);
      this.store.versions.set(path, ++this.store.clock);
    }
  }
}
