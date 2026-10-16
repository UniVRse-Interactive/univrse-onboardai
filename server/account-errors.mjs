import { ChatError } from './chat-errors.mjs';

// Account, session and HR errors. They extend ChatError so the chat routes'
// error mapping (conversationFailure) passes them through unchanged. The
// browser receives { code, error } plus any `details` fields.
export class AccountError extends ChatError {
  constructor(status, code, message, details = null) {
    super(status, code, message);
    if (details) this.details = details;
  }
}

export const accountErrors = {
  notConfigured: () =>
    new AccountError(
      503,
      'ACCOUNTS_NOT_CONFIGURED',
      'Employee accounts are not set up on this server. Continue without an account instead.',
    ),
  unavailable: () =>
    new AccountError(
      503,
      'ACCOUNTS_UNAVAILABLE',
      'Accounts are temporarily unavailable. Please try again shortly.',
    ),
  crossOrigin: () =>
    new AccountError(403, 'CROSS_ORIGIN_REJECTED', 'Open OnboardAi on the website itself.'),
  signInInvalid: () => new AccountError(400, 'SIGN_IN_INVALID', 'Enter your ID and password.'),
  // One response for every failed sign-in: unknown ID, wrong password, disabled
  // or locked account. It must not reveal which one applied.
  signInFailed: () =>
    new AccountError(
      401,
      'SIGN_IN_FAILED',
      'The ID or password is incorrect, or this account cannot sign in right now. Check your details or contact HR.',
    ),
  authRequired: () => new AccountError(401, 'AUTH_REQUIRED', 'Sign in to continue.'),
  sessionExpired: () =>
    new AccountError(401, 'SESSION_EXPIRED', 'Your session has ended. Please sign in again.'),
  passwordChangeRequired: () =>
    new AccountError(403, 'PASSWORD_CHANGE_REQUIRED', 'Choose a new password before continuing.'),
  hrRequired: () => new AccountError(403, 'HR_ROLE_REQUIRED', 'This page is for HR accounts only.'),
  employeeNotFound: () =>
    new AccountError(404, 'EMPLOYEE_NOT_FOUND', 'This employee account was not found.'),
  usernameInvalid: () =>
    new AccountError(
      400,
      'USERNAME_INVALID',
      'Use an ID of 3 to 32 letters, numbers, dots, hyphens or underscores.',
    ),
  usernameTaken: () =>
    new AccountError(409, 'USERNAME_TAKEN', 'That ID is already in use. Choose a different ID.'),
  passwordRejected: (message) => new AccountError(400, 'PASSWORD_REJECTED', message),
  passwordChangeInvalid: () =>
    new AccountError(400, 'PASSWORD_CHANGE_INVALID', 'Enter your current and new password.'),
  // The signed-in account is locked after repeated wrong passwords: its session
  // still works, but no password can be checked or changed until the lock ends.
  accountLocked: () =>
    new AccountError(
      429,
      'ACCOUNT_LOCKED',
      'Too many incorrect passwords. Wait up to 15 minutes, then try again.',
    ),
  currentPasswordIncorrect: () =>
    new AccountError(400, 'CURRENT_PASSWORD_INCORRECT', 'The current password is incorrect.'),
  employeeInvalid: () =>
    new AccountError(
      400,
      'EMPLOYEE_INVALID',
      'Send username, temporaryPassword and profile to create an employee.',
    ),
  statusInvalid: () =>
    new AccountError(400, 'STATUS_INVALID', 'Choose a status of active or disabled.'),
  notFound: () => new AccountError(404, 'NOT_FOUND', 'This account action is unavailable.'),
};

// POST /api/hr/employees/autofill. Fixed messages only: provider text, file
// names and document content never reach the browser.
export const autofillErrors = {
  fileInvalid: () =>
    new AccountError(
      400,
      'AUTOFILL_FILE_INVALID',
      'This file could not be read. Upload a PDF, Word (.docx), text, Markdown, JPG or PNG file that opens without a password.',
    ),
  tooLarge: () =>
    new AccountError(413, 'AUTOFILL_FILE_TOO_LARGE', 'The file must be 5 MB or smaller.'),
  nothingFound: () =>
    new AccountError(
      422,
      'AUTOFILL_NOTHING_FOUND',
      'No employee details were found in this file. Fill in the form yourself.',
    ),
  notConfigured: () =>
    new AccountError(
      503,
      'AUTOFILL_NOT_CONFIGURED',
      'Filling in the form from a document is not set up on this server. Fill in the form yourself.',
    ),
  unavailable: () =>
    new AccountError(
      503,
      'AUTOFILL_UNAVAILABLE',
      'Filling in the form from a document is temporarily unavailable. Try again shortly or fill in the form yourself.',
    ),
  rateLimited: () =>
    new AccountError(
      429,
      'AUTOFILL_RATE_LIMITED',
      'Too many documents are being read right now. Wait a moment, then try again.',
    ),
  timeout: () =>
    new AccountError(
      504,
      'AUTOFILL_TIMEOUT',
      'Reading the document took too long. Try again, or fill in the form yourself.',
    ),
};
