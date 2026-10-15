// Errors shared by both saved-chat stores (SQLite and Firestore), so the browser
// sees the same status, code and message whichever store is configured.
export class ChatError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const chatNotFound = () =>
  new ChatError(
    404,
    'CHAT_NOT_FOUND',
    'This saved chat is unavailable or has expired. Start a new chat.',
  );
export const busyMessages = {
  answer: 'This chat is already preparing an answer. Please wait.',
  erase: 'Wait for this answer to finish before deleting its chat.',
  learning: 'Wait for the answer to finish before changing learning settings.',
  feedback: 'Wait for the answer before updating feedback.',
  eraseOwner: 'Wait for this employee’s answer to finish before removing their record.',
};
export const chatBusy = (message) => new ChatError(409, 'CHAT_BUSY', message);
export const chatLimit = () =>
  new ChatError(
    409,
    'CHAT_LIMIT',
    'You have 30 saved chats. Delete an older chat before starting another.',
  );
export const answerNotFound = () =>
  new ChatError(404, 'ANSWER_NOT_FOUND', 'This answer is unavailable.');
export const feedbackInvalid = () =>
  new ChatError(400, 'FEEDBACK_INVALID', 'Choose Helpful or Still unclear.');
export const supportSettingsInvalid = () =>
  new ChatError(400, 'SUPPORT_SETTINGS_INVALID', 'Choose whether to update your support summary.');

// Firestore failures reach the browser only as these fixed messages. Google
// error text, document paths and chat content are never forwarded.
const storageFailures = {
  STORAGE_NOT_CONFIGURED: [
    503,
    'Saved chats are not fully configured. The administrator should set GOOGLE_CLOUD_PROJECT (or FIRESTORE_PROJECT_ID) together with FIRESTORE_DATABASE_ID.',
  ],
  STORAGE_ACCESS_DENIED: [
    503,
    'Saved chats could not be opened because database access was denied. The administrator should check that the API service account has the Cloud Datastore User role.',
  ],
  STORAGE_NOT_FOUND: [
    503,
    'The saved-chat database was not found. The administrator should check FIRESTORE_DATABASE_ID and GOOGLE_CLOUD_PROJECT.',
  ],
  STORAGE_RATE_LIMIT: [
    429,
    'Saved chats are temporarily at their usage limit. Please wait a moment and try again.',
  ],
  STORAGE_TIMEOUT: [504, 'Saved chats took too long to respond. Please try again.'],
  STORAGE_UNAVAILABLE: [503, 'Saved chats are temporarily unavailable. Please try again shortly.'],
};

export function storageError(code) {
  const known = storageFailures[code] ? code : 'STORAGE_UNAVAILABLE';
  const [status, message] = storageFailures[known];
  return new ChatError(status, known, message);
}
