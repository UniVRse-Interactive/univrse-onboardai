import { ChatError, storageError } from './chat-errors.mjs';

// Every Firestore call made for saved chats is bounded by this deadline. The
// whole answer has 60 seconds (api-routes), so a stalled database fails fast.
export const FIRESTORE_TIMEOUT_MS = 10000;

// FIRESTORE_DATABASE_ID selects Firestore; blank keeps the local SQLite file.
// The project is FIRESTORE_PROJECT_ID, falling back to GOOGLE_CLOUD_PROJECT, so
// a local run can keep GOOGLE_CLOUD_PROJECT for Vertex AI while saved chats and
// employee profiles use the emulator's demo project. Both stores share this.
export function firestoreConfig(env) {
  const databaseId = (env.FIRESTORE_DATABASE_ID || '').trim();
  if (!databaseId) return null;
  const projectId =
    (env.FIRESTORE_PROJECT_ID || '').trim() || (env.GOOGLE_CLOUD_PROJECT || '').trim();
  return { projectId, databaseId };
}

// The client library is loaded on first use, so SQLite-only runs never load it.
// Credentials come from Application Default Credentials (on Cloud Run, the api
// runtime service account). REST transport avoids a gRPC start-up on cold starts.
// The library reads FIRESTORE_EMULATOR_HOST itself; its REST transport still
// asks for Google credentials there, so the emulator is reached over gRPC, and
// a fixed universe domain skips a slow credential lookup the emulator ignores.
export function createFirestoreClient({ projectId, databaseId }) {
  let client = null;
  return async () => {
    const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
    client ||= import('@google-cloud/firestore').then(
      ({ Firestore }) =>
        new Firestore({
          projectId,
          databaseId,
          preferRest: !emulator,
          ignoreUndefinedProperties: true,
          ...(emulator ? { universeDomain: 'googleapis.com' } : {}),
        }),
    );
    try {
      return await client;
    } catch (error) {
      client = null;
      throw error;
    }
  };
}

const grpcNames = {
  1: 'CANCELLED',
  2: 'UNKNOWN',
  3: 'INVALID_ARGUMENT',
  4: 'DEADLINE_EXCEEDED',
  5: 'NOT_FOUND',
  6: 'ALREADY_EXISTS',
  7: 'PERMISSION_DENIED',
  8: 'RESOURCE_EXHAUSTED',
  9: 'FAILED_PRECONDITION',
  10: 'ABORTED',
  11: 'OUT_OF_RANGE',
  12: 'UNIMPLEMENTED',
  13: 'INTERNAL',
  14: 'UNAVAILABLE',
  15: 'DATA_LOSS',
  16: 'UNAUTHENTICATED',
};

// Firestore errors carry a numeric gRPC code (REST errors are translated to the
// same codes); an HTTP status is accepted too. Only the code is inspected.
export function firestoreReason(error) {
  const code = error?.code;
  if (typeof code === 'number') return grpcNames[code] || `HTTP_${code}`;
  if (typeof code === 'string' && /^[A-Z_]+$/.test(code)) return code;
  // No status at all: the client rejected the call before sending it.
  return 'CLIENT_ERROR';
}

export function storageCode(reason) {
  if (['PERMISSION_DENIED', 'UNAUTHENTICATED', 'HTTP_401', 'HTTP_403'].includes(reason))
    return 'STORAGE_ACCESS_DENIED';
  if (['NOT_FOUND', 'HTTP_404'].includes(reason)) return 'STORAGE_NOT_FOUND';
  if (['RESOURCE_EXHAUSTED', 'HTTP_429'].includes(reason)) return 'STORAGE_RATE_LIMIT';
  if (['DEADLINE_EXCEEDED', 'HTTP_504', 'TIMEOUT'].includes(reason)) return 'STORAGE_TIMEOUT';
  return 'STORAGE_UNAVAILABLE';
}

export const alreadyExists = (error) => error?.code === 6 || error?.code === 409;

// call(operation, fn): runs fn with a deadline and turns any failure into a
// ChatError with a fixed message. The log records the operation and the
// Firestore status name only, never chat text, document paths or error text.
export function createStorageCall({
  timeoutMs = FIRESTORE_TIMEOUT_MS,
  log = (message) => console.warn(message),
} = {}) {
  return async function call(operation, fn) {
    let timer;
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([fn(), deadline]);
    } catch (error) {
      if (error instanceof ChatError) throw error;
      const reason = firestoreReason(error),
        code = storageCode(reason);
      log('Firestore request failed: ' + JSON.stringify({ operation, code, reason }));
      throw storageError(code);
    } finally {
      clearTimeout(timer);
    }
  };
}
