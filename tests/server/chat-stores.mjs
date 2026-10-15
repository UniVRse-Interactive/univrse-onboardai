import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatMemory } from '../../server/saved-conversations.mjs';
import {
  createFirestoreChatMemory,
  messageDocId,
  RETENTION_MS,
} from '../../server/firestore-chat-memory.mjs';
import { FakeFirestore } from './fake-firestore.mjs';

// The conversation-store behaviour tests run once per implementation. Each
// entry also knows how to inspect or seed its own raw storage.
const fakes = new WeakMap();
const firestoreMemory = (firestore = new FakeFirestore(), options = {}) => {
  // sweepIntervalMs: 0 removes expired chats on every list, as SQLite does.
  const memory = createFirestoreChatMemory({
    firestore,
    log: () => {},
    sweepIntervalMs: 0,
    ...options,
  });
  fakes.set(memory, firestore);
  return memory;
};

export const chatStores = [
  {
    name: 'SQLite',
    create: () => createChatMemory(':memory:'),
    // A store that can be closed and opened again over the same data.
    persistent() {
      const dir = mkdtempSync(join(tmpdir(), 'alya-memory-')),
        path = join(dir, 'memory.sqlite');
      return {
        open: () => createChatMemory(path),
        cleanup: () => rmSync(dir, { recursive: true, force: true }),
      };
    },
    supportEventData: (memory) =>
      memory.checkpointer.db
        .prepare('SELECT data FROM support_events')
        .all()
        .map((row) => row.data),
    seedHistory(memory, id, { learning, messages }) {
      memory.checkpointer.db
        .prepare('UPDATE conversations SET learning=?,messages=? WHERE id=?')
        .run(JSON.stringify(learning), JSON.stringify(messages), id);
    },
    // Moves a chat's last update back by `ms`.
    age(memory, id, ms) {
      memory.checkpointer.db
        .prepare('UPDATE conversations SET updated=updated-? WHERE id=?')
        .run(ms, id);
    },
    storedRows(memory, id) {
      const db = memory.checkpointer.db;
      const count = (sql) => db.prepare(sql).get(id).n;
      return (
        count('SELECT count(*) n FROM conversations WHERE id=?') +
        count('SELECT count(*) n FROM checkpoints WHERE thread_id=?') +
        count('SELECT count(*) n FROM writes WHERE thread_id=?') +
        count('SELECT count(*) n FROM support_events WHERE conversation_id=?')
      );
    },
  },
  {
    name: 'Firestore',
    create: () => firestoreMemory(),
    persistent() {
      const firestore = new FakeFirestore();
      // Each open is a new client (a restarted instance) over the same database.
      return { open: () => firestoreMemory(firestore.connect()), cleanup() {} };
    },
    supportEventData: (memory) => {
      const fake = fakes.get(memory);
      return fake
        .paths('conversations/')
        .filter((path) => path.split('/').length === 2)
        .flatMap((path) => Object.values(JSON.parse(fake.read(path).support || '{}')))
        .map((event) => JSON.stringify(event.data));
    },
    seedHistory(memory, id, { learning, messages }) {
      const fake = fakes.get(memory),
        path = `conversations/${id}`;
      messages.forEach((message, i) =>
        fake.write(`${path}/messages/${messageDocId(i)}`, {
          id: message.id,
          role: message.role,
          data: JSON.stringify(message),
        }),
      );
      fake.write(path, { ...fake.read(path), learning, messageCount: messages.length });
    },
    age(memory, id, ms) {
      const fake = fakes.get(memory),
        path = `conversations/${id}`,
        data = fake.read(path);
      fake.write(path, { ...data, updated: data.updated - ms });
    },
    storedRows(memory, id) {
      const fake = fakes.get(memory);
      return fake.paths(`conversations/${id}`).length + fake.paths(`chatCheckpoints/${id}/`).length;
    },
  },
];

export { FakeFirestore, firestoreMemory, fakes, RETENTION_MS };
