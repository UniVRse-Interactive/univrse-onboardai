import { randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createChatMemory, ChatError } from './saved-conversations.mjs';
import { guestWorkspaceLifetime, workspaceLimits } from './workspace-limits.mjs';
import { hrOnboardingTasks, validJoiningDate } from './hr-onboarding.mjs';
export { guestWorkspaceLifetime, workspaceLimits } from './workspace-limits.mjs';

// This database contains isolated guest workspaces, never the existing employee database.
export function createGuestWorkspaceStore({
  path = resolve('.cache/guest-workspaces/workspaces.sqlite'),
  geminiAvailable = false,
} = {}) {
  const memory = createChatMemory(path),
    db = memory.checkpointer.db;
  db.exec(`CREATE TABLE IF NOT EXISTS guest_workspaces (
    owner TEXT PRIMARY KEY, created INTEGER NOT NULL, updated INTEGER NOT NULL,
    engine TEXT NOT NULL, last_guest_id TEXT
  ); CREATE TABLE IF NOT EXISTS workspace_guests (
    id TEXT PRIMARY KEY, workspace_owner TEXT NOT NULL, chat_owner TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL, created INTEGER NOT NULL, follow_up TEXT NOT NULL DEFAULT 'not-reviewed', hr_note TEXT NOT NULL DEFAULT ''
  ); CREATE INDEX IF NOT EXISTS guest_workspace_owner ON workspace_guests(workspace_owner);
  CREATE TABLE IF NOT EXISTS workspace_documents (
    id TEXT PRIMARY KEY, workspace_owner TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL,
    fingerprint TEXT NOT NULL, bytes INTEGER NOT NULL, created INTEGER NOT NULL,
    UNIQUE(workspace_owner, fingerprint)
  );`);
  const columns = new Set(
    db
      .prepare('PRAGMA table_info(workspace_documents)')
      .all()
      .map((column) => column.name),
  );
  if (!columns.has('category'))
    db.exec("ALTER TABLE workspace_documents ADD COLUMN category TEXT NOT NULL DEFAULT ''");
  if (!columns.has('google_doc_id'))
    db.exec('ALTER TABLE workspace_documents ADD COLUMN google_doc_id TEXT');
  const guestColumns = new Set(
    db
      .prepare('PRAGMA table_info(workspace_guests)')
      .all()
      .map((column) => column.name),
  );
  for (const [column, definition] of [
    ['start_date', "TEXT NOT NULL DEFAULT ''"],
    ['department', "TEXT NOT NULL DEFAULT ''"],
    ['onboarding_tasks', "TEXT NOT NULL DEFAULT '[]'"],
    ['onboarding_version', 'INTEGER NOT NULL DEFAULT 0'],
  ]) {
    if (!guestColumns.has(column))
      db.exec(`ALTER TABLE workspace_guests ADD COLUMN ${column} ${definition}`);
  }
  // Preserve existing identities and activity while updating display labels.
  db.prepare(
    "UPDATE workspace_guests SET name=REPLACE(name,'Guest employee ','Employee ') WHERE name LIKE 'Guest employee %'",
  ).run();
  function newGuest(owner) {
    const count = db
      .prepare('SELECT COUNT(*) AS n FROM workspace_guests WHERE workspace_owner=?')
      .get(owner).n;
    if (count >= workspaceLimits.guests)
      throw new ChatError(
        409,
        'WORKSPACE_GUEST_LIMIT',
        'This workspace supports up to five employees.',
      );
    const names = new Set(
      db
        .prepare('SELECT name FROM workspace_guests WHERE workspace_owner=?')
        .all(owner)
        .map((person) => person.name),
    );
    let number = 1;
    while (names.has('Employee ' + String(number).padStart(2, '0'))) number++;
    const id = randomUUID();
    db.prepare(
      'INSERT INTO workspace_guests(id,workspace_owner,chat_owner,name,created) VALUES(?,?,?,?,?)',
    ).run(id, owner, 'guest:' + id, 'Employee ' + String(number).padStart(2, '0'), Date.now());
    db.prepare('UPDATE guest_workspaces SET last_guest_id=?,updated=? WHERE owner=?').run(
      id,
      Date.now(),
      owner,
    );
    return guest(owner, id);
  }
  function cleanup() {
    const expired = db
      .prepare('SELECT owner FROM guest_workspaces WHERE updated<?')
      .all(Date.now() - guestWorkspaceLifetime);
    for (const { owner } of expired) {
      let busy = false;
      for (const person of db
        .prepare('SELECT chat_owner FROM workspace_guests WHERE workspace_owner=?')
        .all(owner)) {
        for (const chat of memory.list(person.chat_owner)) {
          try {
            memory.erase(person.chat_owner, chat.id);
          } catch (error) {
            if (error.status === 409) busy = true;
            else throw error;
          }
        }
      }
      if (busy) continue;
      db.prepare(
        'DELETE FROM support_preferences WHERE owner IN (SELECT chat_owner FROM workspace_guests WHERE workspace_owner=?)',
      ).run(owner);
      db.prepare('DELETE FROM workspace_documents WHERE workspace_owner=?').run(owner);
      db.prepare('DELETE FROM workspace_guests WHERE workspace_owner=?').run(owner);
      db.prepare('DELETE FROM guest_workspaces WHERE owner=?').run(owner);
    }
  }
  const touch = db.transaction((owner) => {
    const inserted = db
      .prepare(
        'INSERT OR IGNORE INTO guest_workspaces(owner,created,updated,engine) VALUES(?,?,?,?)',
      )
      .run(owner, Date.now(), Date.now(), geminiAvailable ? 'gemini' : 'search');
    db.prepare('UPDATE guest_workspaces SET updated=? WHERE owner=?').run(Date.now(), owner);
    if (inserted.changes) newGuest(owner);
    return db.prepare('SELECT * FROM guest_workspaces WHERE owner=?').get(owner);
  });
  function ensure(owner) {
    cleanup();
    return touch(owner);
  }
  function guest(owner, id) {
    const result = db
      .prepare('SELECT * FROM workspace_guests WHERE workspace_owner=? AND id=?')
      .get(owner, id);
    if (!result)
      throw new ChatError(
        404,
        'WORKSPACE_GUEST_NOT_FOUND',
        'This guest is not part of your workspace.',
      );
    return result;
  }
  function documents(owner) {
    return db
      .prepare(
        'SELECT id,title,text,bytes,created,fingerprint,category,google_doc_id AS googleDocId FROM workspace_documents WHERE workspace_owner=? ORDER BY created,rowid',
      )
      .all(owner);
  }
  const addDocument = db.transaction((owner, { name, text, bytes }) => {
    const fingerprint = createHash('sha256').update(text).digest('hex');
    const existing = db
      .prepare('SELECT id FROM workspace_documents WHERE workspace_owner=? AND fingerprint=?')
      .get(owner, fingerprint);
    if (existing) return { id: existing.id, duplicate: true };
    const all = documents(owner);
    if (all.length >= workspaceLimits.files)
      throw new ChatError(
        409,
        'WORKSPACE_DOCUMENT_LIMIT',
        'Remove a document before adding more. The workspace supports twelve files.',
      );
    if (
      text.length > workspaceLimits.characters ||
      all.reduce((n, d) => n + d.text.length, 0) + text.length > workspaceLimits.totalCharacters
    )
      throw new ChatError(
        413,
        'WORKSPACE_TEXT_LIMIT',
        'The document text exceeds this workspace’s knowledge limit. Upload a shorter guide.',
      );
    const id = randomUUID();
    db.prepare(
      'INSERT INTO workspace_documents(id,workspace_owner,title,text,fingerprint,bytes,created) VALUES(?,?,?,?,?,?,?)',
    ).run(id, owner, name, text, fingerprint, bytes, Date.now());
    return { id, duplicate: false };
  });
  function checkGoogleDocConnection(owner, { text, googleDocId, category }) {
    const all = documents(owner);
    const sameLink = all.find((doc) => doc.googleDocId === googleDocId);
    const slot = category === 'additional' ? null : all.find((doc) => doc.category === category);
    if (sameLink && sameLink.id !== slot?.id) {
      if (sameLink.category === category) return { id: sameLink.id, duplicate: true };
      throw new ChatError(
        409,
        'GOOGLE_DOC_ALREADY_CONNECTED',
        'This Google Doc is already connected to another topic. Choose a different document.',
      );
    }
    const fingerprint = createHash('sha256').update(text).digest('hex');
    if (all.some((doc) => doc.id !== slot?.id && doc.fingerprint === fingerprint))
      throw new ChatError(
        409,
        'GOOGLE_DOC_ALREADY_CONNECTED',
        'This guidance is already in your library. Connect a different Google Doc.',
      );
    const others = all.filter((doc) => doc.id !== slot?.id);
    if (!slot && all.length >= workspaceLimits.files)
      throw new ChatError(
        409,
        'WORKSPACE_DOCUMENT_LIMIT',
        'The workspace supports twelve documents. Remove one before adding another.',
      );
    if (
      text.length > workspaceLimits.characters ||
      others.reduce((n, doc) => n + doc.text.length, 0) + text.length >
        workspaceLimits.totalCharacters
    )
      throw new ChatError(
        413,
        'WORKSPACE_TEXT_LIMIT',
        'These guides exceed the workspace’s readable text limit. Use a shorter guide.',
      );
    const id = slot?.id || randomUUID();
    return { id, duplicate: false, replaced: !!slot };
  }
  const connectGoogleDoc = db.transaction((owner, document) => {
    const plan = checkGoogleDocConnection(owner, document);
    if (plan.duplicate) return plan;
    const { name, text, googleDocId, category } = document;
    const { id } = plan;
    const fingerprint = createHash('sha256').update(text).digest('hex');
    if (plan.replaced) {
      db.prepare(
        'UPDATE workspace_documents SET title=?,text=?,fingerprint=?,bytes=?,created=?,category=?,google_doc_id=? WHERE workspace_owner=? AND id=?',
      ).run(
        name,
        text,
        fingerprint,
        Buffer.byteLength(text),
        Date.now(),
        category,
        googleDocId,
        owner,
        id,
      );
    } else {
      db.prepare(
        'INSERT INTO workspace_documents(id,workspace_owner,title,text,fingerprint,bytes,created,category,google_doc_id) VALUES(?,?,?,?,?,?,?,?,?)',
      ).run(
        id,
        owner,
        name,
        text,
        fingerprint,
        Buffer.byteLength(text),
        Date.now(),
        category,
        googleDocId,
      );
    }
    return plan;
  });
  function removeDocument(owner, id) {
    if (
      !db.prepare('DELETE FROM workspace_documents WHERE workspace_owner=? AND id=?').run(owner, id)
        .changes
    )
      throw new ChatError(
        404,
        'WORKSPACE_DOCUMENT_NOT_FOUND',
        'That document is not in your workspace.',
      );
  }
  function snapshot(owner) {
    const workspace = ensure(owner);
    const guests = db
      .prepare('SELECT * FROM workspace_guests WHERE workspace_owner=? ORDER BY created,rowid')
      .all(owner)
      .map((person) => ({
        id: person.id,
        name: person.name,
        created: person.created,
        onboarding: {
          startDate: person.start_date,
          department: person.department,
          completed: JSON.parse(person.onboarding_tasks),
          version: person.onboarding_version,
        },
        summary: memory.supportSummary(person.chat_owner),
      }));
    return {
      lastGuestId: workspace.last_guest_id,
      expiresAt: workspace.updated + guestWorkspaceLifetime,
      documents: documents(owner).map(({ text, fingerprint, ...doc }) => ({
        ...doc,
        characters: text.length,
      })),
      guests,
      limits: workspaceLimits,
    };
  }
  return {
    checkGoogleDocConnection,
    memory,
    ensure,
    guest,
    selectGuest(owner, id) {
      const person = guest(owner, id);
      db.prepare('UPDATE guest_workspaces SET last_guest_id=? WHERE owner=?').run(id, owner);
      return person;
    },
    newGuest,
    updateOnboarding: db.transaction((owner, id, input) => {
      const person = guest(owner, id);
      const { startDate, department, completed, version } = input || {};
      if (
        !input ||
        Array.isArray(input) ||
        Object.keys(input).some(
          (key) => !['startDate', 'department', 'completed', 'version'].includes(key),
        ) ||
        !validJoiningDate(startDate) ||
        typeof department !== 'string' ||
        department.trim().length > 64 ||
        /[\u0000-\u001f\u007f]/.test(department) ||
        !Array.isArray(completed) ||
        completed.length > hrOnboardingTasks.length ||
        completed.some((task) => !hrOnboardingTasks.some((item) => item.id === task)) ||
        new Set(completed).size !== completed.length ||
        !Number.isSafeInteger(version) ||
        version < 0
      )
        throw new ChatError(
          400,
          'ONBOARDING_INVALID',
          'Check the joining date, department and onboarding milestones.',
        );
      if (version !== person.onboarding_version)
        throw new ChatError(
          409,
          'ONBOARDING_CHANGED',
          'This record changed in another tab. Close this form, refresh the workspace and try again.',
        );
      db.prepare(
        'UPDATE workspace_guests SET start_date=?,department=?,onboarding_tasks=?,onboarding_version=onboarding_version+1 WHERE workspace_owner=? AND id=?',
      ).run(startDate, department.trim(), JSON.stringify(completed), owner, id);
      return { startDate, department: department.trim(), completed, version: version + 1 };
    }),
    removeGuest: db.transaction((owner, id) => {
      const person = guest(owner, id);
      memory.eraseOwner(person.chat_owner);
      db.prepare('DELETE FROM workspace_guests WHERE workspace_owner=? AND id=?').run(owner, id);
      const next = db
        .prepare(
          'SELECT id FROM workspace_guests WHERE workspace_owner=? ORDER BY created,rowid LIMIT 1',
        )
        .get(owner);
      db.prepare(
        'UPDATE guest_workspaces SET last_guest_id=CASE WHEN last_guest_id=? THEN ? ELSE last_guest_id END WHERE owner=?',
      ).run(id, next?.id || null, owner);
    }),
    documents,
    addDocument,
    connectGoogleDoc,
    removeDocument,
    snapshot,
    guestForConversation(id) {
      return db
        .prepare(
          'SELECT g.* FROM workspace_guests g JOIN conversations c ON c.owner=g.chat_owner WHERE c.id=?',
        )
        .get(id);
    },
    close: () => memory.close(),
  };
}
