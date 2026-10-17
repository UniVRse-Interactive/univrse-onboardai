import { createHash, randomUUID } from 'node:crypto';
import { AccountError } from './account-errors.mjs';
import { ChatError } from './chat-errors.mjs';
import { createStorageCall } from './firestore-client.mjs';
import { workspaceLimits } from './workspace-limits.mjs';

// The company-wide knowledge library that signed-in HR builds by uploading
// files, one Firestore document per file: companyDocuments/{id}
//
//   category      one of the five onboarding area IDs, or 'additional'
//   title         the document's own title: HR's name for it, or the file name
//                 without its extension (never the area's title)
//   fileName      the uploaded file's name (absent on documents connected from
//                 Google Docs before issue #35, which still list and retrieve)
//   text          the file's extracted plain text (at most 250,000 characters)
//   characters, bytes (the file's size), fingerprint (SHA-256 of text)
//   connectedBy   the HR account ID; connectedAt: ISO 8601
//
// The original file is never stored. The rules mirror the former guest workspace
// library from #28, changed by #68: an area holds any number of documents (an
// upload adds, never replaces), forty documents and 1,500,000 characters in
// total, and no text twice. Every call is bounded by the Firestore deadline;
// log lines name the operation and Firestore status only, never file names,
// titles or text.
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
  textTaken: () =>
    new AccountError(
      409,
      'COMPANY_DOCUMENT_DUPLICATE',
      'This guidance is already in the company library in another area. Upload a different file.',
    ),
  full: () =>
    new AccountError(
      409,
      'WORKSPACE_DOCUMENT_LIMIT',
      `The company library supports ${workspaceLimits.files} documents. Remove one before adding another.`,
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

// Where an upload goes, given the stored documents ({ id, category,
// fingerprint, characters }): { id, duplicate: true } when identical text is
// already stored in this area, else { id, duplicate: false } for a new
// document. An upload only ever adds. Throws the 409/413 errors.
export function planUpload(stored, { text, category }) {
  const fingerprint = fingerprintOf(text);
  const same = stored.find((doc) => doc.fingerprint === fingerprint);
  if (same && same.category === category) return { id: same.id, duplicate: true };
  if (same) throw companyDocumentErrors.textTaken();
  if (stored.length >= workspaceLimits.files) throw companyDocumentErrors.full();
  if (
    text.length > workspaceLimits.characters ||
    stored.reduce((total, doc) => total + doc.characters, 0) + text.length >
      workspaceLimits.totalCharacters
  )
    throw companyDocumentErrors.tooMuchText();
  return { id: randomUUID(), duplicate: false };
}

// Moving document `id` to `category`: { unchanged } is true when it is
// already there. 404 for an unknown id, 409 when another document
// in the library already holds the same text.
export function planMove(stored, id, category) {
  const document = stored.find((doc) => doc.id === id);
  if (!document) throw companyDocumentErrors.notFound();
  if (document.category === category) return { unchanged: true };
  if (stored.some((doc) => doc.id !== id && doc.fingerprint === document.fingerprint))
    throw companyDocumentErrors.textTaken();
  return { unchanged: false };
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
    fileName: String(data.fileName || ''),
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
    // Every stored document with its text, oldest first.
    list: () =>
      guarded('list company documents', async () => {
        const found = await collection(await database()).get();
        return found.docs.map(stored).sort(byConnection);
      }),
    // upload: { category, title, fileName, text, bytes }. Checks and writes in
    // one transaction, so two HR browsers cannot both take the last place.
    add: (upload, connectedBy, at) =>
      guarded('add company document', async () => {
        const db = await database();
        return db.runTransaction(async (tx) => {
          const current = await tx.get(
            collection(db).select('category', 'fingerprint', 'characters'),
          );
          const plan = planUpload(
            current.docs.map((doc) => ({
              id: doc.id,
              ...doc.data(),
              characters: Number(doc.data().characters) || 0,
            })),
            upload,
          );
          if (plan.duplicate) return plan;
          const { category, title, fileName, text, bytes } = upload;
          tx.set(collection(db).doc(plan.id), {
            category,
            title,
            fileName,
            text,
            characters: text.length,
            bytes,
            fingerprint: fingerprintOf(text),
            connectedBy,
            connectedAt: at.toISOString(),
          });
          return plan;
        });
      }),
    // One stored document with its text, or the 404.
    get: (id) =>
      guarded('read company document', async () => {
        if (typeof id !== 'string' || !idPattern.test(id)) throw companyDocumentErrors.notFound();
        const found = await collection(await database())
          .doc(id)
          .get();
        if (!found.exists) throw companyDocumentErrors.notFound();
        return stored(found);
      }),
    // Moves one document to another category (checked and written in one
    // transaction): 404 for an unknown id, 409 when another document already
    // holds the same text. Resolves to the stored document.
    move: (id, category) =>
      guarded('move company document', async () => {
        if (typeof id !== 'string' || !idPattern.test(id)) throw companyDocumentErrors.notFound();
        const db = await database();
        await db.runTransaction(async (tx) => {
          const current = await tx.get(
            collection(db).select('category', 'fingerprint', 'characters'),
          );
          const plan = planMove(
            current.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
            id,
            category,
          );
          if (!plan.unchanged) tx.update(collection(db).doc(id), { category });
        });
        return stored(await collection(db).doc(id).get());
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
