import { createHash, randomBytes } from 'node:crypto';
import { accountErrors, departmentErrors } from './account-errors.mjs';
import { createAccountStore, createDatabasePool } from './account-store.mjs';
import { formatEmployeeId, prefixPattern, reservedPrefix } from './employee-ids.mjs';
import { createFirestoreClient } from './firestore-client.mjs';
import {
  createProfileStore,
  profileStorageErrors,
  profileSummary,
  validateProfile,
} from './employee-profiles.mjs';
import {
  dummyPasswordHash,
  generatePassword,
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
const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
// A server-assigned Employee ID can only be taken by an account made outside
// the counter (hr:create); each try uses up a number, so a few are enough.
const employeeIdAttempts = 3;
const lockedAt = (row, at) => Boolean(row.locked_until) && new Date(row.locked_until) > at;
// Chat-store failures (ChatError STORAGE_*) on HR routes answer like the other
// Firestore failures there; anything else (CHAT_BUSY) passes through.
const asProfileStorageError = (error) =>
  error?.code === 'STORAGE_TIMEOUT'
    ? profileStorageErrors.timeout()
    : typeof error?.code === 'string' && error.code.startsWith('STORAGE_')
      ? profileStorageErrors.unavailable()
      : error;

// Department names (issue #36): one line, trimmed, 1 to 60 characters.
export const departmentNameMax = 60;
const controlCharacters = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;
// The check for one department field: { value } or { problem }.
function checkDepartmentField(field, raw) {
  if (raw === undefined || raw === null) return { problem: 'required' };
  if (typeof raw !== 'string') return { problem: 'invalid_format' };
  const value = raw.trim();
  if (!value) return { problem: 'required' };
  if (field === 'name') {
    if ([...value].length > departmentNameMax) return { problem: 'too_long' };
    if (controlCharacters.test(value)) return { problem: 'invalid_format' };
  } else {
    if (!prefixPattern.test(value)) return { problem: 'invalid_format' };
    if (value === reservedPrefix) return { problem: 'reserved' };
  }
  return { value };
}

// The chat store's summary scope describes a browser's chats; an account's
// chats follow the employee, so HR's summaries say so.
export const accountSummaryScope = 'This employee’s saved conversations';

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

  // Departments (issue #36), kept in the departments table. exampleId only
  // shows the format; employees counts the profiles whose job.department
  // equals the name.
  const departmentView = (row, employees) => ({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    archived: row.archived,
    exampleId: formatEmployeeId(row.prefix, 1),
    employees,
  });
  // The count after a change is a courtesy: a Firestore failure there must not
  // turn a change that already succeeded into an error.
  async function employeesIn(name) {
    try {
      return (await profiles.countByDepartment()).get(name) || 0;
    } catch {
      return 0;
    }
  }
  // The names of the active departments, the choices for a new hire and the
  // autofill's enum.
  async function activeDepartmentNames() {
    return (await store.activeDepartments()).map((row) => row.name);
  }
  // Active departments first, then by name, with their employee counts.
  async function listDepartments() {
    const rows = await store.listDepartments();
    const counts = await profiles.countByDepartment();
    return rows.map((row) => departmentView(row, counts.get(row.name) || 0));
  }
  function departmentFields(body, keys) {
    if (!isPlainObject(body)) throw departmentErrors.invalid([]);
    const problems = [],
      values = {};
    for (const key of keys) {
      if (key === 'archived') {
        if (typeof body.archived !== 'boolean')
          problems.push({ field: key, problem: 'invalid_format' });
        else values.archived = body.archived;
        continue;
      }
      const checked = checkDepartmentField(key, body[key]);
      if (checked.problem) problems.push({ field: key, problem: checked.problem });
      else values[key] = checked.value;
    }
    if (problems.length) throw departmentErrors.invalid(problems);
    return values;
  }
  // POST /api/hr/departments { name, prefix } -> { department }.
  async function createDepartment(actor, body) {
    if (!isPlainObject(body)) throw departmentErrors.invalid([]);
    const unknown = Object.keys(body).filter((key) => !['name', 'prefix'].includes(key));
    if (unknown.length) throw departmentErrors.invalid([]);
    const values = departmentFields(body, ['name', 'prefix']);
    const row = await store.createDepartment(actor.account.id, values, now());
    return { department: departmentView(row, await employeesIn(row.name)) };
  }
  // PATCH /api/hr/departments/:id { name?, prefix?, archived? } ->
  // { department, updatedProfiles }. A new name is also written to every
  // profile with the old one, before the change is committed: if Firestore
  // fails, the department keeps its name (503/504) and a retry works.
  async function updateDepartment(actor, id, body) {
    if (!isPlainObject(body)) throw departmentErrors.invalid([]);
    const keys = Object.keys(body);
    if (!keys.length || keys.some((key) => !['name', 'prefix', 'archived'].includes(key)))
      throw departmentErrors.invalid([]);
    const changes = departmentFields(body, keys);
    if (!validId(id)) throw departmentErrors.notFound();
    let renamed = null;
    let result;
    try {
      result = await store.updateDepartment(
        actor.account.id,
        id,
        changes,
        now(),
        async (before, after) => {
          if (before.name !== after.name)
            renamed = await profiles.renameDepartment(before.name, after.name);
        },
      );
    } catch (error) {
      // The commit failed after the profiles were renamed: put them back.
      if (renamed) await renamed.undo().catch(() => {});
      throw error;
    }
    if (!result) throw departmentErrors.notFound();
    const employees = renamed ? renamed.updated : await employeesIn(result.after.name);
    return {
      department: departmentView(result.after, employees),
      updatedProfiles: renamed ? renamed.updated : 0,
    };
  }

  // The one way an employee account is created: HR's "Add employee account"
  // (POST /api/hr/employees) and the employee form import approval (#27).
  //   profile: ProfileInput. job.department must be the name of an active
  //            department (the departments table); its prefix decides the
  //            Employee ID.
  //   actorId: the HR account creating the employee (created_by, the event
  //            actor and the profile's updatedBy).
  // Resolves to { employee: { account: EmployeeAccount, profile: Profile },
  // temporaryPassword }, or throws 400 PROFILE_INVALID, 503
  // ACCOUNTS_UNAVAILABLE, 503 PROFILE_STORAGE_UNAVAILABLE or 504
  // PROFILE_STORAGE_TIMEOUT. The server picks the Employee ID (the department's
  // next number) and a generated temporary password with a forced change. The
  // password is returned to the caller only: it is stored as its scrypt hash
  // and never logged. Consistent across both stores: Postgres insert, then the
  // Firestore profile, then the commit; a failed profile write rolls the account
  // back (its number stays used). If the commit itself fails after the profile
  // was written, the orphaned profile is removed (best effort).
  async function createEmployeeAccount({ profile: input, actorId } = {}) {
    if (!validId(actorId)) throw new TypeError('createEmployeeAccount needs the HR actorId.');
    const active = await store.activeDepartments();
    const profile = validateProfile(input, { activeDepartments: active.map((row) => row.name) });
    const prefix = active.find((row) => row.name === profile.job.department).prefix;
    const temporaryPassword = generatePassword();
    const passwordHash = await hashing.hash(temporaryPassword);
    const at = now();
    for (let attempt = 1; ; attempt++) {
      let createdId = null,
        saved = null;
      try {
        const row = await store.createEmployee(
          { prefix, passwordHash, createdBy: actorId, at },
          async (account) => {
            if (passwordProblem(temporaryPassword, account.username))
              throw new Error('The generated password does not meet the password rules.');
            createdId = account.id;
            saved = await profiles.write(account.id, profile, actorId, at);
          },
        );
        return { employee: { account: accountView(row, at), profile: saved }, temporaryPassword };
      } catch (error) {
        if (createdId) await profiles.remove(createdId).catch(() => {});
        if (error?.code !== 'USERNAME_TAKEN') throw error;
        if (attempt >= employeeIdAttempts) throw accountErrors.unavailable();
      }
    }
  }

  // POST /api/hr/employees: { profile } only. The Employee ID and the
  // temporary password are the server's, so any other key (username,
  // temporaryPassword) is 400 EMPLOYEE_INVALID.
  async function createEmployee(actor, body) {
    if (!isPlainObject(body) || Object.keys(body).some((key) => key !== 'profile'))
      throw accountErrors.employeeInvalid();
    return createEmployeeAccount({ profile: body.profile, actorId: actor.account.id });
  }

  // A department that is not active is accepted only when it is the one already
  // stored (archived since, or saved before the list existed), so it stays
  // editable.
  async function replaceProfile(actor, id, body) {
    if (!validId(id)) throw accountErrors.employeeNotFound();
    const job = isPlainObject(body?.profile) ? body.profile.job : undefined;
    const requested =
      isPlainObject(job) && typeof job.department === 'string' ? job.department.trim() : '';
    const activeDepartments = await activeDepartmentNames();
    const keepDepartment = activeDepartments.includes(requested)
      ? undefined
      : ((await profiles.read(id))?.job.department ?? '');
    const profile = validateProfile(body?.profile, { keepDepartment, activeDepartments });
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

  // Deletes an employee's personal data, then the account. eraseChats(owner)
  // removes the account's chats, checkpoints and support preferences from the
  // chat store. The account is signed out first, Firestore is cleaned next (every
  // step is safe to repeat), and only then is the PostgreSQL account deleted,
  // so a Firestore failure leaves the account in place and a retry finishes the
  // job. HR accounts are never deleted here (404 EMPLOYEE_NOT_FOUND).
  async function deleteEmployee(actor, id, { eraseChats }) {
    const row = await employeeOrThrow(id);
    await store.endEmployeeSessions(row.id);
    try {
      await eraseChats(`account:${row.id}`);
    } catch (error) {
      throw asProfileStorageError(error);
    }
    await profiles.removeAccountData(row.id);
    const deleted = await store.deleteEmployee(actor.account.id, row.id, now());
    if (!deleted) throw accountErrors.employeeNotFound();
  }

  // One entry per employee account, in the /employees order: the display name
  // (preferred name, else full name, else the ID) and the support summary of
  // the account's chats. summaryOf(owner) is the chat store's supportSummary:
  // aggregates only, never questions, answers or document text. Only its
  // `scope` text is replaced.
  async function supportSummaries(summaryOf) {
    const listed = await listEmployees();
    const employees = [];
    for (let i = 0; i < listed.length; i += 10) {
      const batch = listed.slice(i, i + 10);
      employees.push(
        ...(await Promise.all(
          batch.map(async ({ account, profile }) => {
            let summary;
            try {
              summary = await summaryOf(`account:${account.id}`);
            } catch (error) {
              throw asProfileStorageError(error);
            }
            return {
              account,
              name: profile?.preferredName || profile?.fullName || account.username,
              summary: { ...summary, scope: accountSummaryScope },
            };
          }),
        )),
      );
    }
    return employees;
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
    listDepartments,
    activeDepartmentNames,
    createDepartment,
    updateDepartment,
    createEmployeeAccount,
    createEmployee,
    replaceProfile,
    resetPassword,
    setStatus,
    deleteEmployee,
    supportSummaries,
    close: async () => {
      await Promise.allSettled([store.close?.(), profiles.close?.()]);
    },
  };
}
