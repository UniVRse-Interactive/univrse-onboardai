import { createHash, randomUUID } from 'node:crypto';
import { AccountError } from './account-errors.mjs';
import { ChatError } from './chat-errors.mjs';
import { createStorageCall } from './firestore-client.mjs';
import { workspaceLimits } from './workspace-limits.mjs';

// The company-wide Google Docs library that signed-in HR builds, one Firestore
// document per connected Doc: companyDocuments/{id}
//
//   category      one of the six onboarding topic IDs, or 'additional'
//   title         the topic's title, or HR's name for an additional guide
//   googleDocId   the Google Docs file ID
//   text          the Doc's plain text when it was connected (at most 250,000 characters)
//   characters, bytes, fingerprint (SHA-256 of text)
//   connectedBy   the HR account ID; connectedAt: ISO 8601
//
// The rules mirror the guest workspace library from #28: one Doc per topic
// (connecting another replaces it), any number of additional guides, twelve
// documents and 750,000 characters in total, and no Doc or text twice. Every
// call is bounded by the Firestore deadline; log lines name the operation and
// Firestore status only, never titles or text.
export const companyDocumentCollection = 'companyDocuments';
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fingerprintOf = (text) => createHash('sha256').update(text).digest('hex');

export const companyDocumentErrors = {
  notFound: () =>
    new AccountError(
      404,
      'WORKSPACE_DOCUMENT_NOT_FOUND',
      'That document is not in the company library.',
    ),
  topicTaken: () =>
    new AccountError(
      409,
      'GOOGLE_DOC_ALREADY_CONNECTED',
      'This Google Doc is already connected to another topic. Choose a different document.',
    ),
  textTaken: () =>
    new AccountError(
      409,
      'GOOGLE_DOC_ALREADY_CONNECTED',
      'This guidance is already in the company library. Connect a different Google Doc.',
    ),
  full: () =>
    new AccountError(
      409,
      'WORKSPACE_DOCUMENT_LIMIT',
      'The company library supports twelve documents. Remove one before adding another.',
    ),
  tooMuchText: () =>
    new AccountError(
      413,
      'WORKSPACE_TEXT_LIMIT',
      'These guides exceed the company library’s readable text limit. Use a shorter guide.',
    ),
  unavailable: () =>
    new AccountError(
      503,
      'COMPANY_KNOWLEDGE_UNAVAILABLE',
      'The company document library is temporarily unavailable. Please try again shortly.',
    ),
  timeout: () =>
    new AccountError(
      504,
      'COMPANY_KNOWLEDGE_TIMEOUT',
      'The company document library took too long to respond. Please try again.',
    ),
};

// Where a new connection goes, given the stored documents ({ id, category,
// googleDocId, fingerprint, characters }): { id, duplicate: true } when this
// Doc already serves this topic (or is already an additional guide), else
// { id, duplicate: false, replaced } where replaced means the topic's current
// Doc is swapped (or refreshed, for the same link). Throws the 409/413 errors.
export function planConnection(stored, { text, googleDocId, category }) {
  const sameLink = stored.find((doc) => doc.googleDocId === googleDocId);
  const slot = category === 'additional' ? null : stored.find((doc) => doc.category === category);
  if (sameLink && sameLink.id !== slot?.id) {
    if (sameLink.category === category) return { id: sameLink.id, duplicate: true };
    throw companyDocumentErrors.topicTaken();
  }
  const fingerprint = fingerprintOf(text);
  if (stored.some((doc) => doc.id !== slot?.id && doc.fingerprint === fingerprint))
    throw companyDocumentErrors.textTaken();
  const others = stored.filter((doc) => doc.id !== slot?.id);
  if (!slot && stored.length >= workspaceLimits.files) throw companyDocumentErrors.full();
  if (
    text.length > workspaceLimits.characters ||
    others.reduce((total, doc) => total + doc.characters, 0) + text.length >
      workspaceLimits.totalCharacters
  )
    throw companyDocumentErrors.tooMuchText();
  return { id: slot?.id || randomUUID(), duplicate: false, replaced: Boolean(slot) };
}

const created = (data) => {
  const at = Date.parse(data.connectedAt);
  return Number.isFinite(at) ? at : 0;
};
const stored = (doc) => {
  const data = doc.data();
  return {
    id: doc.id,
    title: String(data.title || ''),
    category: String(data.category || ''),
    googleDocId: String(data.googleDocId || ''),
    text: String(data.text || ''),
    characters: Number(data.characters) || 0,
    bytes: Number(data.bytes) || 0,
    fingerprint: String(data.fingerprint || ''),
    connectedBy: data.connectedBy || null,
    connectedAt: data.connectedAt || null,
    created: created(data),
  };
};
const byConnection = (a, b) => a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function createCompanyDocumentStore({
  // A Firestore instance, or an async function returning one.
  firestore,
  timeoutMs,
  log,
}) {
  let client = null;
  const database = async () =>
    (client ??= await (typeof firestore === 'function' ? firestore() : firestore));
  const call = createStorageCall({ timeoutMs, log });
  const guarded = async (operation, fn) => {
    try {
      return await call(operation, fn);
    } catch (error) {
      if (error instanceof ChatError && !String(error.code).startsWith('STORAGE_')) throw error;
      if (error?.code === 'STORAGE_TIMEOUT') throw companyDocumentErrors.timeout();
      throw companyDocumentErrors.unavailable();
    }
  };
  const collection = (db) => db.collection(companyDocumentCollection);

  return {
    // Every connected document with its text, oldest connection first.
    list: () =>
      guarded('list company documents', async () => {
        const found = await collection(await database()).get();
        return found.docs.map(stored).sort(byConnection);
      }),
    // connection: { category, title, googleDocId, text }. Checks and writes in
    // one transaction, so two HR browsers cannot both take the last place.
    connect: (connection, connectedBy, at) =>
      guarded('connect company document', async () => {
        const db = await database();
        return db.runTransaction(async (tx) => {
          const current = await tx.get(
            collection(db).select('category', 'googleDocId', 'fingerprint', 'characters'),
          );
          const plan = planConnection(
            current.docs.map((doc) => ({
              id: doc.id,
              ...doc.data(),
              characters: Number(doc.data().characters) || 0,
            })),
            connection,
          );
          if (plan.duplicate) return plan;
          const { category, title, googleDocId, text } = connection;
          tx.set(collection(db).doc(plan.id), {
            category,
            title,
            googleDocId,
            text,
            characters: text.length,
            bytes: Buffer.byteLength(text),
            fingerprint: fingerprintOf(text),
            connectedBy,
            connectedAt: at.toISOString(),
          });
          return plan;
        });
      }),
    remove: (id) =>
      guarded('remove company document', async () => {
        if (typeof id !== 'string' || !idPattern.test(id)) throw companyDocumentErrors.notFound();
        const db = await database();
        const ref = collection(db).doc(id);
        await db.runTransaction(async (tx) => {
          if (!(await tx.get(ref)).exists) throw companyDocumentErrors.notFound();
          tx.delete(ref);
        });
      }),
    close: async () => {
      const open = client;
      client = null;
      await open?.terminate?.();
    },
  };
}
