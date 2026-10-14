import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { normaliseLearning } from './answer-style-preferences.mjs';
import { createSupportStore } from './employee-support-tracking.mjs';

export class ChatError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const sessionHash = (token) => createHash('sha256').update(token).digest('hex');
const retention = 30 * 24 * 60 * 60 * 1000;

export function createChatMemory(path = resolve('.cache/chat/conversations.sqlite')) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const checkpointer = SqliteSaver.fromConnString(path),
    db = checkpointer.db;
  checkpointer.setup();
  db.pragma('secure_delete = ON');
  db.exec(`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL,
    messages TEXT NOT NULL DEFAULT '[]', created INTEGER NOT NULL, updated INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS conversation_owner ON conversations(owner,updated);`);
  if (!db.pragma('table_info(conversations)').some((column) => column.name === 'learning'))
    db.exec("ALTER TABLE conversations ADD COLUMN learning TEXT NOT NULL DEFAULT '{}'");
  const busy = new Set();
  const support = createSupportStore(db, {
    owned,
    isBusy: (id) => busy.has(id),
    error: (...args) => new ChatError(...args),
    retention,
  });
  function owned(owner, id) {
    const row = db.prepare('SELECT * FROM conversations WHERE id=? AND owner=?').get(id, owner);
    if (!row || row.updated < Date.now() - retention)
      throw new ChatError(
        404,
        'CHAT_NOT_FOUND',
        'This saved chat is unavailable or has expired. Start a new chat.',
      );
    return row;
  }
  const remove = db.transaction((id) => {
    support.remove(id);
    db.prepare('DELETE FROM writes WHERE thread_id=?').run(id);
    db.prepare('DELETE FROM checkpoints WHERE thread_id=?').run(id);
    db.prepare('DELETE FROM conversations WHERE id=?').run(id);
  });
  function cleanup() {
    for (const row of db
      .prepare('SELECT id FROM conversations WHERE updated<?')
      .all(Date.now() - retention))
      if (!busy.has(row.id)) remove(row.id);
  }
  function list(owner) {
    cleanup();
    return db
      .prepare(
        'SELECT id,title,created,updated FROM conversations WHERE owner=? ORDER BY updated DESC',
      )
      .all(owner);
  }
  function create(owner) {
    if (list(owner).length >= 30)
      throw new ChatError(
        409,
        'CHAT_LIMIT',
        'You have 30 saved chats. Delete an older chat before starting another.',
      );
    const id = randomUUID(),
      now = Date.now();
    db.prepare('INSERT INTO conversations(id,owner,title,created,updated) VALUES(?,?,?,?,?)').run(
      id,
      owner,
      'New conversation',
      now,
      now,
    );
    return {
      id,
      title: 'New conversation',
      messages: [],
      learning: normaliseLearning(),
      created: now,
      updated: now,
    };
  }
  function read(owner, id) {
    const row = owned(owner, id);
    return {
      ...row,
      owner: undefined,
      messages: JSON.parse(row.messages),
      learning: normaliseLearning(JSON.parse(row.learning)),
    };
  }
  function erase(owner, id) {
    owned(owner, id);
    if (busy.has(id))
      throw new ChatError(
        409,
        'CHAT_BUSY',
        'Wait for this answer to finish before deleting its chat.',
      );
    remove(id);
    db.pragma('wal_checkpoint(TRUNCATE)');
  }
  function acquire(owner, id) {
    const row = read(owner, id);
    if (busy.has(id))
      throw new ChatError(
        409,
        'CHAT_BUSY',
        'This chat is already preparing an answer. Please wait.',
      );
    busy.add(id);
    return { row, release: () => busy.delete(id) };
  }
  const save = db.transaction((owner, id, messages, learning) => {
    const row = owned(owner, id),
      title = messages.find((m) => m.role === 'user')?.text.slice(0, 65) || row.title;
    db.prepare(
      'UPDATE conversations SET messages=?,title=?,updated=?,learning=? WHERE id=? AND owner=?',
    ).run(
      JSON.stringify(messages),
      title,
      Date.now(),
      JSON.stringify(normaliseLearning(learning)),
      id,
      owner,
    );
    // Keep the latest complete checkpoint and its parent; historical replay is
    // not exposed. Visible history remains in the conversation record.
    const ids = db
      .prepare(
        'SELECT checkpoint_id FROM checkpoints WHERE thread_id=? ORDER BY checkpoint_id DESC LIMIT 2',
      )
      .all(id)
      .map((r) => r.checkpoint_id);
    if (ids.length === 2)
      db.transaction(() => {
        db.prepare('DELETE FROM writes WHERE thread_id=? AND checkpoint_id NOT IN (?,?)').run(
          id,
          ...ids,
        );
        db.prepare('DELETE FROM checkpoints WHERE thread_id=? AND checkpoint_id NOT IN (?,?)').run(
          id,
          ...ids,
        );
      })();
    const answer = messages.at(-1),
      question = messages.at(-2);
    if (answer?.role === 'assistant' && answer.id && answer.requestId && answer.result)
      support.turn(owner, id, answer.id, question?.text || '', answer.result);
  });
  function setLearning(owner, id, learning) {
    owned(owner, id);
    if (busy.has(id))
      throw new ChatError(
        409,
        'CHAT_BUSY',
        'Wait for the answer to finish before changing learning settings.',
      );
    const clean = normaliseLearning(learning);
    db.prepare('UPDATE conversations SET learning=?,updated=? WHERE id=? AND owner=?').run(
      JSON.stringify(clean),
      Date.now(),
      id,
      owner,
    );
    return clean;
  }
  return {
    checkpointer,
    list,
    create,
    read,
    erase,
    acquire,
    save,
    setLearning,
    supportSummary: (owner) => {
      cleanup();
      return support.summary(owner);
    },
    supportSettings: support.settings,
    feedback: support.feedback,
    voiceEvent: support.voice,
    humanHelp: support.humanHelp,
    close: () => db.close(),
  };
}
