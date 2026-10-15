import { createHash, randomBytes } from 'node:crypto';
import { accountErrors } from './account-errors.mjs';
import { createAccountStore, createDatabasePool } from './account-store.mjs';
import { createFirestoreClient } from './firestore-client.mjs';
import { createProfileStore, profileSummary, validateProfile } from './employee-profiles.mjs';
import {
  dummyPasswordHash,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from './password-hashing.mjs';

// HR and employee accounts: sign-in, sessions, forced password changes and the
// HR actions. PostgreSQL holds the accounts (account-store.mjs); Firestore holds
// the personal profiles (employee-profiles.mjs). No plaintext password or
// session token is stored or logged; only their scrypt hash and SHA-256.
export const SESSION_MS = 12 * 60 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;
export const MAX_FAILED_SIGN_INS = 5;
export const usernamePattern = /^[A-Za-z0-9._-]{3,32}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const tokenPattern = /^[0-9a-f]{64}$/;
// A well-formed ID that no account has.
const noAccount = '00000000-0000-0000-0000-000000000000';
export const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const iso = (value) => (value ? new Date(value).toISOString() : null);
const lockedAt = (row, at) => Boolean(row.locked_until) && new Date(row.locked_until) > at;

// What a signed-in browser learns about its own account.
const selfView = (row, expiresAt) => ({
  id: row.id,
  username: row.username,
  role: row.role,
  mustChangePassword: row.must_change_password,
  sessionExpiresAt: iso(expiresAt),
});
// What HR sees about an employee account. Never the password hash.
export const accountView = (row, at) => ({
  id: row.id,
  username: row.username,
  role: row.role,
  status: row.status,
  mustChangePassword: row.must_change_password,
  locked: lockedAt(row, at),
  lockedUntil: lockedAt(row, at) ? iso(row.locked_until) : null,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
  lastSignInAt: iso(row.last_sign_in_at),
});

// Builds the real backends from accountSettings(env).
export function createAccountBackends(settings) {
  return {
    store: createAccountStore({ pool: createDatabasePool(settings.databaseUrl) }),
    profiles: createProfileStore({ firestore: createFirestoreClient(settings.firestore) }),
  };
}

export function createAccountService({
  store,
  profiles,
  now = () => new Date(),
  hashing = { hash: hashPassword, verify: verifyPassword, dummy: dummyPasswordHash },
  sessionMs = SESSION_MS,
  lockMs = LOCK_MS,
  maxFailures = MAX_FAILED_SIGN_INS,
  log = (line) => console.warn(line),
}) {
  // Made now, so the first unknown-ID sign-in costs no more than any other.
  hashing.dummy().catch(() => {});
  const newSession = (at) => {
    const token = randomBytes(32).toString('hex');
    return {
      token,
      tokenHash: tokenHash(token),
      createdAt: at,
      expiresAt: new Date(at.getTime() + sessionMs),
    };
  };
  const checkPassword = (password, username) => {
    const problem = passwordProblem(password, username);
    if (problem) throw accountErrors.passwordRejected(problem);
  };
  const validId = (id) => typeof id === 'string' && uuidPattern.test(id);
  async function employeeOrThrow(id) {
    if (!validId(id)) throw accountErrors.employeeNotFound();
    const row = await store.employee(id);
    if (!row) throw accountErrors.employeeNotFound();
    return row;
  }

  // The session for a cookie value, or null when it is malformed, unknown,
  // expired, or its account is disabled. Expired rows are removed. A lock
  // blocks new sign-ins only: existing sessions keep working, so wrong guesses
  // by someone else cannot sign the account holder out.
  async function session(token) {
    if (typeof token !== 'string' || !tokenPattern.test(token)) return null;
    const hash = tokenHash(token);
    const row = await store.sessionAccount(hash);
    const at = now();
    if (!row) return null;
    if (new Date(row.session_expires_at) <= at) {
      await store.deleteSession(hash);
      return null;
    }
    if (row.status !== 'active') return null;
    return { account: selfView(row, row.session_expires_at), tokenHash: hash };
  }

  // Always runs exactly one scrypt check, against a dummy hash when the ID is
  // unknown, so the response time does not reveal which IDs exist. Every
  // failure is the same 401 SIGN_IN_FAILED.
  async function signIn(body, previousToken) {
    const { username, password } = body || {};
    if (
      typeof username !== 'string' ||
      !username.trim() ||
      typeof password !== 'string' ||
      !password
    )
      throw accountErrors.signInInvalid();
    const name = username.trim();
    const row = usernamePattern.test(name) ? await store.findForSignIn(name) : null;
    const matches = await hashing.verify(password, row?.password_hash ?? (await hashing.dummy()));
    const at = now();
    const usable = row && row.status === 'active' && !lockedAt(row, at);
    if (!usable || !matches) {
      // The same database work for every failure: the update matches no row
      // for an unknown ID or a disabled or locked account.
      const { locked } = await store.recordFailure(usable ? row.id : noAccount, at, {
        limit: maxFailures,
        lockedUntil: new Date(at.getTime() + lockMs),
      });
      if (locked) log('Account locked after repeated failed sign-ins.');
      throw accountErrors.signInFailed();
    }
    const fresh = newSession(at);
    const replaced =
      typeof previousToken === 'string' && tokenPattern.test(previousToken)
        ? tokenHash(previousToken)
        : null;
    if (!(await store.signIn(row.id, at, fresh, replaced))) throw accountErrors.signInFailed();
    return { token: fresh.token, account: selfView(row, fresh.expiresAt), sessionMs };
  }

  async function signOut(token) {
    if (typeof token === 'string' && tokenPattern.test(token))
      await store.deleteSession(tokenHash(token));
  }

  // The signed-in account changes its own password. A wrong current password
  // counts towards the lockout; reaching it keeps this session. While locked,
  // no password is checked here (that would allow unlimited guesses with a
  // session). On success every session of the account ends and a new one is
  // returned (rotation).
  async function changePassword(current, body) {
    const { currentPassword, newPassword } = body || {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword)
      throw accountErrors.passwordChangeInvalid();
    const row = await store.findById(current.account.id);
    if (!row || row.status !== 'active') throw accountErrors.sessionExpired();
    const at = now();
    if (lockedAt(row, at)) throw accountErrors.accountLocked();
    if (!(await hashing.verify(currentPassword, row.password_hash))) {
      await store.recordFailure(row.id, at, {
        limit: maxFailures,
        lockedUntil: new Date(at.getTime() + lockMs),
      });
      throw accountErrors.currentPasswordIncorrect();
    }
    checkPassword(newPassword, row.username);
    if (newPassword === currentPassword)
      throw accountErrors.passwordRejected('Choose a password different from your current one.');
    const fresh = newSession(at);
    const updated = await store.changePassword(row.id, await hashing.hash(newPassword), at, fresh);
    if (!updated) {
      // Disabled or locked since the check above.
      const latest = await store.findById(row.id);
      if (latest?.status === 'active' && lockedAt(latest, at)) throw accountErrors.accountLocked();
      throw accountErrors.sessionExpired();
    }
    return { token: fresh.token, account: selfView(updated, fresh.expiresAt), sessionMs };
  }

  async function myProfile(account) {
    return profiles.read(account.id);
  }

  async function listEmployees() {
    const rows = await store.listEmployees();
    const found = await profiles.readMany(rows.map((row) => row.id));
    const at = now();
    return rows.map((row) => ({
      account: accountView(row, at),
      profile: profileSummary(found.get(row.id)) || null,
    }));
  }

  async function getEmployee(id) {
    const row = await employeeOrThrow(id);
    return { account: accountView(row, now()), profile: await profiles.read(row.id) };
  }

  // Postgres insert, then the Firestore profile, then the commit: a failed
  // profile write rolls the account back. If the commit itself fails after the
  // profile was written, the orphaned profile is removed (best effort).
  async function createEmployee(actor, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw accountErrors.employeeInvalid();
    const { username, temporaryPassword, profile: input } = body;
    if (typeof username !== 'string' || !usernamePattern.test(username.trim()))
      throw accountErrors.usernameInvalid();
    const name = username.trim();
    checkPassword(temporaryPassword, name);
    const profile = validateProfile(input);
    const passwordHash = await hashing.hash(temporaryPassword);
    const at = now();
    let createdId = null,
      saved = null;
    try {
      const row = await store.createAccount(
        {
          username: name,
          passwordHash,
          role: 'employee',
          mustChangePassword: true,
          createdBy: actor.account.id,
          action: 'employee_created',
          at,
        },
        async (account) => {
          createdId = account.id;
          saved = await profiles.write(account.id, profile, actor.account.id, at);
        },
      );
      return { account: accountView(row, at), profile: saved };
    } catch (error) {
      if (createdId) await profiles.remove(createdId).catch(() => {});
      throw error;
    }
  }

  async function replaceProfile(actor, id, body) {
    if (!validId(id)) throw accountErrors.employeeNotFound();
    const profile = validateProfile(body?.profile);
    const at = now();
    let saved = null;
    const row = await store.employeeChange(
      actor.account.id,
      id,
      'profile_updated',
      at,
      async () => {
        saved = await profiles.write(id, profile, actor.account.id, at);
      },
    );
    if (!row) throw accountErrors.employeeNotFound();
    return { account: accountView(row, at), profile: saved };
  }

  async function resetPassword(actor, id, body) {
    const row = await employeeOrThrow(id);
    checkPassword(body?.temporaryPassword, row.username);
    const updated = await store.resetPassword(
      actor.account.id,
      id,
      await hashing.hash(body.temporaryPassword),
      now(),
    );
    if (!updated) throw accountErrors.employeeNotFound();
    return { account: accountView(updated, now()) };
  }

  async function setStatus(actor, id, body) {
    if (!['active', 'disabled'].includes(body?.status)) throw accountErrors.statusInvalid();
    if (!validId(id)) throw accountErrors.employeeNotFound();
    const updated = await store.setStatus(actor.account.id, id, body.status, now());
    if (!updated) throw accountErrors.employeeNotFound();
    return { account: accountView(updated, now()) };
  }

  return {
    sessionMs,
    session,
    signIn,
    signOut,
    changePassword,
    myProfile,
    listEmployees,
    getEmployee,
    createEmployee,
    replaceProfile,
    resetPassword,
    setStatus,
    close: async () => {
      await Promise.allSettled([store.close?.(), profiles.close?.()]);
    },
  };
}
