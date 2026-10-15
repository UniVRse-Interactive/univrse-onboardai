import { createHash, randomUUID } from 'node:crypto';
import { normaliseLearning } from './answer-style-preferences.mjs';
import {
  feedbackRatings,
  isSupportSettings,
  summariseSupport,
  turnObservation,
} from './employee-support-tracking.mjs';
import {
  answerNotFound,
  busyMessages,
  chatBusy,
  chatLimit,
  chatNotFound,
  feedbackInvalid,
  supportSettingsInvalid,
} from './chat-errors.mjs';
import { FirestoreSaver, commitInBatches, deleteOperation } from './firestore-checkpointer.mjs';
import { alreadyExists, createStorageCall } from './firestore-client.mjs';

// Saved chats in Firestore, used when FIRESTORE_DATABASE_ID is set. Same
// promise-based interface and behaviour as the SQLite store
// (saved-conversations.mjs). Layout (docs/chat-and-memory.md):
//
//   conversations/{chatId}                 owner, title, learning, messageCount, support,
//                                          created, updated, turnToken, turnUntil [, deleting]
//   conversations/{chatId}/messages/{0000-0159}  id, role, data (the message as JSON)
//   supportPreferences/{sha256(owner)}     owner, recording, revision, updated
//   chatCheckpoints/{chatId}/...           LangGraph state, see firestore-checkpointer.mjs
//
// `support` holds the chat's support observations (at most 80 answers x 4
// kinds) as JSON, so a summary reads one document per chat, not one per event.
// The owner is an opaque key from api-routes; it is stored as given and hashed
// for document IDs. Times are milliseconds since the epoch. Every query filters
// on a single field and sorting happens here, so Firestore's automatic
// single-field indexes cover them all: no composite index is needed.
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_CHATS = 30;
// A turn leases its chat in Firestore so a second turn, deletion or feedback
// waits, on any server instance. The answer itself is cut off after 60 seconds.
export const TURN_LEASE_MS = 120000;
export const SWEEP_INTERVAL_MS = 60000;
const SWEEP_BATCH = 10;
export const collections = {
  conversations: 'conversations',
  messages: 'messages',
  supportPreferences: 'supportPreferences',
  checkpoints: 'chatCheckpoints',
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const conversationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const messageDocId = (index) => String(index).padStart(4, '0');
export const ownerDocId = (owner) => sha256(String(owner));
// One observation per (kind, answer), as SQLite's UNIQUE(conversation, message, kind).
const supportKey = (kind, messageId) => `${kind}:${messageId}`;
const supportOf = (data) => JSON.parse(data?.support || '{}');

export function createFirestoreChatMemory({
  // A Firestore instance, or an async function returning one.
  firestore,
  now = Date.now,
  timeoutMs,
  log,
  sweepIntervalMs = SWEEP_INTERVAL_MS,
} = {}) {
  let client = null;
  const database = async () =>
    (client ??= await (typeof firestore === 'function' ? firestore() : firestore));
  const call = createStorageCall({ timeoutMs, log });
  const checkpointer = new FirestoreSaver({
    firestore: database,
    call,
    root: collections.checkpoints,
  });

  async function paths() {
    const db = await database();
    return {
      db,
      conversations: db.collection(collections.conversations),
      preferences: db.collection(collections.supportPreferences),
    };
  }
  // Conversation IDs come from the URL; only server-made UUIDs address a document.
  function chatRef(p, id) {
    if (typeof id !== 'string' || !conversationIdPattern.test(id)) throw chatNotFound();
    return p.conversations.doc(id);
  }
  const messagesOf = (ref) => ref.collection(collections.messages);
  const expired = (data, at) => data.updated < at - RETENTION_MS;
  const leased = (data, at) => Boolean(data.turnToken) && data.turnUntil > at;
  const visible = (data, owner, at) =>
    Boolean(data) && data.owner === owner && !data.deleting && !expired(data, at);
  // Like SQLite's list: a running answer keeps its chat listed.
  const listed = (data, at) => !data.deleting && (!expired(data, at) || leased(data, at));
  const view = (id, data, messages) => ({
    id,
    title: data.title,
    messages: messages.docs.slice(0, data.messageCount).map((doc) => JSON.parse(doc.data().data)),
    created: data.created,
    updated: data.updated,
    learning: normaliseLearning(data.learning),
  });

  // Support preferences: the recording switch and a revision bumped whenever
  // the summary changes. Transactional reads come before any write.
  async function preferenceIn(tx, p, owner) {
    const ref = p.preferences.doc(ownerDocId(owner));
    const snapshot = await tx.get(ref);
    return { owner, ref, pref: snapshot.exists ? snapshot.data() : null };
  }
  function bump(tx, prefs, at) {
    tx.set(prefs.ref, {
      owner: prefs.owner,
      recording: prefs.pref ? prefs.pref.recording : true,
      revision: (prefs.pref?.revision || 0) + 1,
      updated: at,
    });
  }
  // Records an observation in a chat's `support` map unless recording is
  // paused or it is unchanged. Returns whether the map changed.
  function observe(tx, prefs, support, kind, messageId, data, at) {
    if (prefs.pref && !prefs.pref.recording) return false;
    const key = supportKey(kind, messageId);
    if (support[key] && JSON.stringify(support[key].data) === JSON.stringify(data)) return false;
    support[key] = { kind, messageId, data, updated: at };
    bump(tx, prefs, at);
    return true;
  }
  async function preference(p, owner) {
    const ref = p.preferences.doc(ownerDocId(owner));
    const snapshot = await ref.get();
    if (snapshot.exists) return snapshot.data();
    const fresh = { owner, recording: true, revision: 0, updated: now() };
    try {
      await ref.create(fresh);
      return fresh;
    } catch (error) {
      if (!alreadyExists(error)) throw error;
      return (await ref.get()).data();
    }
  }
  // Reads the preference document and one document per chat of this owner.
  function summary(owner) {
    return call('read support summary', async () => {
      const p = await paths();
      const [pref, chats] = await Promise.all([
        preference(p, owner),
        p.conversations.where('owner', '==', owner).select('updated', 'deleting', 'support').get(),
      ]);
      const at = now();
      return summariseSupport(
        chats.docs
          .filter((doc) => !doc.data().deleting && !expired(doc.data(), at))
          .flatMap((doc) =>
            Object.values(supportOf(doc.data())).map((event) => ({
              conversationId: doc.id,
              kind: event.kind,
              data: event.data,
              updated: event.updated,
            })),
          ),
        { recording: !!pref.recording, version: pref.revision, updatedAt: pref.updated },
      );
    });
  }

  // Deletes a chat's graph state, its messages and finally the chat document
  // (with its support observations), so an interrupted purge is found again.
  async function purge(id) {
    await checkpointer.deleteThread(id);
    await call('delete chat', async () => {
      const p = await paths();
      const ref = p.conversations.doc(id);
      const messages = await messagesOf(ref).select().get();
      await commitInBatches(
        p.db,
        messages.docs.map((doc) => deleteOperation(doc.ref)),
      );
      await p.db.runTransaction(async (tx) => {
        const data = (await tx.get(ref)).data();
        if (!data) return;
        const observed = Object.keys(supportOf(data)).length > 0;
        const prefs = observed && data.owner ? await preferenceIn(tx, p, data.owner) : null;
        tx.delete(ref);
        if (prefs) bump(tx, prefs, now());
      });
    });
  }
  // Removes chats 30 days after their last update (deleted chats are marked
  // with updated = 0). This sweep is the expiry mechanism: `updated` is a
  // number, not a timestamp, and a Firestore TTL policy would not delete
  // subcollections anyway. It runs at most once per interval per process;
  // expired chats are hidden by every read whether or not they have been swept.
  let lastSweep = -Infinity;
  async function sweep() {
    const at = now();
    if (at - lastSweep < sweepIntervalMs) return;
    lastSweep = at;
    try {
      const stale = await call('find expired chats', async () =>
        (await paths()).conversations
          .where('updated', '<', at - RETENTION_MS)
          .select('turnToken', 'turnUntil')
          .limit(SWEEP_BATCH)
          .get(),
      );
      for (const doc of stale.docs) if (!leased(doc.data(), at)) await purge(doc.id);
    } catch {
      // Logged by call(); the next sweep retries.
    }
  }

  async function list(owner) {
    await sweep();
    return call('list chats', async () => {
      const p = await paths(),
        at = now();
      const found = await p.conversations
        .where('owner', '==', owner)
        .select('title', 'created', 'updated', 'deleting', 'turnToken', 'turnUntil')
        .get();
      return found.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((chat) => listed(chat, at))
        .sort((a, b) => b.updated - a.updated || b.created - a.created)
        .map(({ id, title, created, updated }) => ({ id, title, created, updated }));
    });
  }
  async function create(owner) {
    await sweep();
    return call('create chat', async () => {
      const p = await paths();
      return p.db.runTransaction(async (tx) => {
        const mine = await tx.get(
          p.conversations
            .where('owner', '==', owner)
            .select('updated', 'deleting', 'turnToken', 'turnUntil'),
        );
        const at = now();
        if (mine.docs.filter((doc) => listed(doc.data(), at)).length >= MAX_CHATS)
          throw chatLimit();
        const id = randomUUID(),
          learning = normaliseLearning();
        tx.create(p.conversations.doc(id), {
          owner,
          title: 'New conversation',
          learning,
          messageCount: 0,
          support: '{}',
          created: at,
          updated: at,
          turnToken: null,
          turnUntil: 0,
        });
        return { id, title: 'New conversation', messages: [], learning, created: at, updated: at };
      });
    });
  }
  function read(owner, id) {
    return call('read chat', async () => {
      const p = await paths(),
        ref = chatRef(p, id);
      const snapshot = await ref.get(),
        data = snapshot.data();
      if (!visible(data, owner, now())) throw chatNotFound();
      return view(id, data, await messagesOf(ref).get());
    });
  }
  async function erase(owner, id) {
    await call('delete chat', async () => {
      const p = await paths(),
        ref = chatRef(p, id);
      await p.db.runTransaction(async (tx) => {
        const data = (await tx.get(ref)).data(),
          at = now();
        if (!data || data.owner !== owner) throw chatNotFound();
        if (data.deleting) return; // An interrupted delete finishes below.
        if (expired(data, at)) throw chatNotFound();
        if (leased(data, at)) throw chatBusy(busyMessages.erase);
        // Hidden at once; the purge below (or a later sweep) removes the data.
        tx.update(ref, { deleting: true, updated: 0, turnToken: null, turnUntil: 0 });
      });
    });
    await purge(id);
  }
  // Takes the chat's lease, then reads its history: while the lease is held no
  // other request can change the messages.
  async function acquire(owner, id) {
    const token = randomUUID();
    const data = await call('start answer', async () => {
      const p = await paths(),
        ref = chatRef(p, id);
      return p.db.runTransaction(async (tx) => {
        const data = (await tx.get(ref)).data(),
          at = now();
        if (!visible(data, owner, at)) throw chatNotFound();
        if (leased(data, at)) throw chatBusy(busyMessages.answer);
        tx.update(ref, { turnToken: token, turnUntil: at + TURN_LEASE_MS });
        return data;
      });
    });
    let held = true,
      pruning = null;
    // Never throws: an unreleased lease expires after TURN_LEASE_MS.
    async function release() {
      await pruning;
      if (!held) return;
      held = false;
      try {
        await call('finish answer', async () => {
          const p = await paths(),
            ref = chatRef(p, id);
          await p.db.runTransaction(async (tx) => {
            const current = (await tx.get(ref)).data();
            if (current?.turnToken === token) tx.update(ref, { turnToken: null, turnUntil: 0 });
          });
        });
      } catch {
        // Logged by call().
      }
    }
    let messages;
    try {
      messages = await call('start answer', async () =>
        messagesOf(chatRef(await paths(), id)).get(),
      );
    } catch (error) {
      await release();
      throw error;
    }
    return {
      row: view(id, data, messages),
      save: async (added, learning) => {
        await saveTurn(owner, id, token, added, learning);
        held = false;
        // As in SQLite, keep the latest complete checkpoint and its parent. This
        // runs while the caller reads the summary; release() waits for it. A
        // failed prune is retried after the next answer.
        pruning = checkpointer.prune(id, 2).catch(() => {});
      },
      release,
    };
  }
  // Appends a completed turn and ends the lease in one transaction. A turn
  // that lost its lease cannot write. If this call times out, the transaction
  // may still commit: a retry with the same request ID then gets the saved
  // answer (the commit also ends the lease).
  async function saveTurn(owner, id, token, added, learning) {
    const answer = added.at(-1),
      question = added.at(-2);
    const observed = answer?.role === 'assistant' && answer.id && answer.requestId && answer.result;
    await call('save answer', async () => {
      const p = await paths(),
        ref = chatRef(p, id);
      await p.db.runTransaction(async (tx) => {
        const data = (await tx.get(ref)).data(),
          at = now();
        if (!visible(data, owner, at)) throw chatNotFound();
        if (data.turnToken !== token) throw chatBusy(busyMessages.answer);
        const prefs = observed ? await preferenceIn(tx, p, owner) : null;
        const start = data.messageCount,
          support = supportOf(data);
        added.forEach((message, i) =>
          tx.set(messagesOf(ref).doc(messageDocId(start + i)), {
            id: message.id,
            role: message.role,
            data: JSON.stringify(message),
          }),
        );
        if (prefs) {
          const observation = turnObservation(question?.text || '', answer.result);
          observe(tx, prefs, support, 'turn', answer.id, observation, at);
        }
        tx.update(ref, {
          title: start
            ? data.title
            : added.find((m) => m.role === 'user')?.text.slice(0, 65) || data.title,
          learning: normaliseLearning(learning),
          messageCount: start + added.length,
          support: JSON.stringify(support),
          updated: at,
          turnToken: null,
          turnUntil: 0,
        });
      });
    });
  }
  function setLearning(owner, id, learning) {
    return call('save learning settings', async () => {
      const p = await paths(),
        ref = chatRef(p, id);
      return p.db.runTransaction(async (tx) => {
        const data = (await tx.get(ref)).data(),
          at = now();
        if (!visible(data, owner, at)) throw chatNotFound();
        if (leased(data, at)) throw chatBusy(busyMessages.learning);
        const clean = normaliseLearning(learning);
        tx.update(ref, { learning: clean, updated: at });
        return clean;
      });
    });
  }
  // Feedback, voice starts and help requests on one saved answer. `apply`
  // returns the chat fields to update, or null for none.
  async function answerEvent(operation, owner, id, messageId, apply) {
    await call(operation, async () => {
      const p = await paths(),
        ref = chatRef(p, id);
      await p.db.runTransaction(async (tx) => {
        const data = (await tx.get(ref)).data(),
          at = now();
        if (!visible(data, owner, at)) throw chatNotFound();
        if (leased(data, at)) throw chatBusy(busyMessages.feedback);
        if (typeof messageId !== 'string') throw answerNotFound();
        const found = await tx.get(messagesOf(ref).where('id', '==', messageId));
        const doc = found.docs.find(
          (d) => Number(d.id) < data.messageCount && d.data().role === 'assistant',
        );
        if (!doc) throw answerNotFound();
        const prefs = await preferenceIn(tx, p, owner);
        const message = JSON.parse(doc.data().data),
          support = supportOf(data);
        const changes = apply({ tx, doc, message, support, prefs, at });
        if (changes) tx.update(ref, { ...changes, support: JSON.stringify(support) });
      });
    });
    return summary(owner);
  }
  function feedback(owner, id, messageId, rating) {
    if (!feedbackRatings.includes(rating)) return Promise.reject(feedbackInvalid());
    return answerEvent('save feedback', owner, id, messageId, (a) => {
      a.message.feedback = rating;
      a.tx.update(a.doc.ref, { data: JSON.stringify(a.message) });
      const key = supportKey('feedback', messageId);
      if (rating) observe(a.tx, a.prefs, a.support, 'feedback', messageId, { rating }, a.at);
      else if (a.support[key]) {
        delete a.support[key];
        bump(a.tx, a.prefs, a.at);
      }
      return { updated: a.at };
    });
  }
  // Like SQLite, a voice start does not count as activity on the chat.
  function voiceEvent(owner, id, messageId) {
    return answerEvent('save voice event', owner, id, messageId, (a) =>
      observe(a.tx, a.prefs, a.support, 'voice', messageId, {}, a.at) ? {} : null,
    );
  }
  function humanHelp(owner, id, messageId) {
    return answerEvent('save help request', owner, id, messageId, (a) => {
      a.message.humanHelpRequested = true;
      a.tx.update(a.doc.ref, { data: JSON.stringify(a.message) });
      observe(a.tx, a.prefs, a.support, 'help', messageId, {}, a.at);
      return { updated: a.at };
    });
  }
  async function supportSettings(owner, patch) {
    if (!isSupportSettings(patch)) throw supportSettingsInvalid();
    await call('save support settings', async () => {
      const p = await paths();
      await p.db.runTransaction(async (tx) => {
        const prefs = await preferenceIn(tx, p, owner);
        tx.set(prefs.ref, {
          owner,
          recording: patch.recording,
          revision: (prefs.pref?.revision || 0) + 1,
          updated: now(),
        });
      });
    });
    return summary(owner);
  }

  return {
    checkpointer,
    list,
    create,
    read,
    erase,
    acquire,
    setLearning,
    supportSummary: async (owner) => {
      await sweep();
      return summary(owner);
    },
    supportSettings,
    feedback,
    voiceEvent,
    humanHelp,
    close: async () => {
      const open = client;
      client = null;
      await open?.terminate?.();
    },
  };
}
