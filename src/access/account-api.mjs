// Browser client for the account routes (server/account-routes.mjs).
// The session is an HttpOnly cookie that same-origin fetch sends by itself:
// nothing here reads, stores or logs a password or token.

export class AccountApiError extends Error {
  constructor({ status = 0, code = '', message = '', fields = [] }) {
    super(message || 'The request could not be completed. Please try again.');
    this.name = 'AccountApiError';
    this.status = status;
    this.code = code;
    this.fields = Array.isArray(fields) ? fields : [];
  }
}

// What the whole app must do for an error from any route, chat included.
// 'sign-in': the session ended. 'change-password': a forced change is pending.
export function accountErrorAction({ status, code } = {}) {
  if (status === 401 && code === 'SESSION_EXPIRED') return 'sign-in';
  if (status === 403 && code === 'PASSWORD_CHANGE_REQUIRED') return 'change-password';
  return null;
}

const listeners = new Set();
export function subscribeAccountErrors(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
// Called for every failed response, including chat routes, so one handler can
// send the browser back to sign-in or to the change-password screen.
export function reportAccountResponse(status, data) {
  const action = accountErrorAction({ status, code: data?.code });
  if (action) for (const listener of [...listeners]) listener(action);
  return action;
}

let sessionVerifier = null;
export function registerSessionVerifier(verifier) {
  sessionVerifier = verifier;
  return () => {
    if (sessionVerifier === verifier) sessionVerifier = null;
  };
}
// Resolves false when a signed-in browser no longer has a session. Chat calls
// this before sending so a question is never answered anonymously by mistake.
export async function ensureSession() {
  return sessionVerifier ? sessionVerifier() : true;
}

export const signInNotice = 'Your session ended. Sign in again.';

export function networkErrorMessage() {
  return 'Could not reach the server. Check your connection and try again.';
}

export async function accountRequest(
  path,
  { method = 'GET', body, signal, report = true, fetchImpl = globalThis.fetch } = {},
) {
  let response;
  try {
    response = await fetchImpl(path, {
      method,
      signal,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new AccountApiError({ message: networkErrorMessage() });
  }
  if (response.status === 204) return null;
  let data = null;
  try {
    data = await response.json();
  } catch {}
  if (!response.ok) {
    if (report) reportAccountResponse(response.status, data);
    throw new AccountApiError({
      status: response.status,
      code: data?.code || '',
      message: data?.error || '',
      fields: data?.fields,
    });
  }
  return data;
}

const enc = encodeURIComponent;
export const accountApi = {
  config: (options) => accountRequest('/api/config', options),
  session: (options) => accountRequest('/api/auth/session', options),
  signIn: (username, password) =>
    accountRequest('/api/auth/sign-in', { method: 'POST', body: { username, password } }),
  signOut: () => accountRequest('/api/auth/sign-out', { method: 'POST' }),
  changePassword: (currentPassword, newPassword) =>
    accountRequest('/api/auth/password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),
  myProfile: (options) => accountRequest('/api/me/profile', options),
  listEmployees: (options) => accountRequest('/api/hr/employees', options),
  createEmployee: (username, temporaryPassword, profile) =>
    accountRequest('/api/hr/employees', {
      method: 'POST',
      body: { username, temporaryPassword, profile },
    }),
  employee: (id, options) => accountRequest('/api/hr/employees/' + enc(id), options),
  saveProfile: (id, profile) =>
    accountRequest('/api/hr/employees/' + enc(id) + '/profile', {
      method: 'PUT',
      body: { profile },
    }),
  resetPassword: (id, temporaryPassword) =>
    accountRequest('/api/hr/employees/' + enc(id) + '/password', {
      method: 'POST',
      body: { temporaryPassword },
    }),
  setStatus: (id, status) =>
    accountRequest('/api/hr/employees/' + enc(id) + '/status', {
      method: 'PUT',
      body: { status },
    }),
};
