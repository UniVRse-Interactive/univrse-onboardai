import pg from 'pg';
import { ChatError } from './chat-errors.mjs';
import { accountErrors } from './account-errors.mjs';

// Sign-in data in PostgreSQL (tables in server/migrations/001_accounts.sql):
// accounts, sessions (SHA-256 of each token only) and account_events. Every
// time comes from the caller, so tests can move the clock. Database failures
// become 503 ACCOUNTS_UNAVAILABLE; the log records the operation and the
// SQLSTATE or error code only, never values, usernames or connection details.

export function createDatabasePool(databaseUrl, { log = (line) => console.warn(line) } = {}) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
    query_timeout: 12000,
    application_name: 'onboardai',
  });
  // An idle client losing its connection must not crash the server.
  pool.on('error', (error) =>
    log('Account database connection error: ' + JSON.stringify({ code: safeCode(error) })),
  );
  return pool;
}

const safeCode = (error) =>
  typeof error?.code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(error.code)
    ? error.code
    : error?.name || 'UNKNOWN';

const columns =
  'id, username, role, status, must_change_password, failed_attempts, locked_until, ' +
  'created_at, updated_at, last_sign_in_at, created_by';
const accountColumns = (alias) =>
  columns
    .split(', ')
    .map((column) => `${alias}.${column}`)
    .join(', ');
const uniqueViolation = '23505';

export function createAccountStore({ pool, log = (line) => console.warn(line) }) {
  function failure(operation, error) {
    if (error instanceof ChatError) return error;
    log('Account database request failed: ' + JSON.stringify({ operation, code: safeCode(error) }));
    return accountErrors.unavailable();
  }
  async function run(operation, text, values) {
    try {
      return await pool.query(text, values);
    } catch (error) {
      throw failure(operation, error);
    }
  }
  // Runs work(query) inside one transaction. Anything work throws (including a
  // Firestore failure) rolls the whole transaction back.
  async function transaction(operation, work) {
    let client;
    try {
      client = await pool.connect();
    } catch (error) {
      throw failure(operation, error);
    }
    try {
      await client.query('BEGIN');
      const result = await work((text, values) => client.query(text, values));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw failure(operation, error);
    } finally {
      client.release();
    }
  }
  const event = (query, actorId, targetId, action, at) =>
    query(
      'INSERT INTO account_events (actor_id, target_id, action, created_at) VALUES ($1, $2, $3, $4)',
      [actorId, targetId, action, at],
    );
  const insertSession = (query, accountId, session) =>
    query(
      'INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
      [session.tokenHash, accountId, session.createdAt, session.expiresAt],
    );
  // Usable for sign-in: active and not locked at `at`.
  const usable = `status = 'active' AND (locked_until IS NULL OR locked_until <= $2)`;

  return {
    // The account row with its password hash, for sign-in only.
    async findForSignIn(username) {
      const found = await run(
        'find account',
        `SELECT ${columns}, password_hash FROM accounts WHERE lower(username) = lower($1)`,
        [username],
      );
      return found.rows[0] || null;
    },
    async findById(id) {
      const found = await run(
        'read account',
        `SELECT ${columns}, password_hash FROM accounts WHERE id = $1`,
        [id],
      );
      return found.rows[0] || null;
    },

    // Counts a wrong password for an active, unlocked account. Reaching `limit`
    // consecutive failures locks it until `lockedUntil`; a failure after a lock
    // has ended starts a new count. Returns { locked } for this failure.
    async recordFailure(id, at, { limit, lockedUntil }) {
      return transaction('record failed sign-in', async (query) => {
        const updated = await query(
          `UPDATE accounts SET
             failed_attempts = (CASE WHEN locked_until IS NULL THEN failed_attempts ELSE 0 END) + 1,
             locked_until = CASE
               WHEN (CASE WHEN locked_until IS NULL THEN failed_attempts ELSE 0 END) + 1 >= $3
               THEN $4::timestamptz ELSE NULL END
           WHERE id = $1 AND ${usable}
           RETURNING locked_until`,
          [id, at, limit, lockedUntil],
        );
        const locked = Boolean(updated.rows[0]?.locked_until);
        if (locked) await event(query, null, id, 'account_locked', at);
        return { locked };
      });
    },

    // Opens a session for an account that is still active and unlocked; returns
    // false if it changed since the password was checked. A session cookie the
    // browser already had is deleted (rotation), as are expired sessions.
    async signIn(id, at, session, replacedHash) {
      return transaction('sign in', async (query) => {
        const updated = await query(
          `UPDATE accounts SET failed_attempts = 0, locked_until = NULL, last_sign_in_at = $2
           WHERE id = $1 AND ${usable} RETURNING id`,
          [id, at],
        );
        if (!updated.rows.length) return false;
        if (replacedHash) await query('DELETE FROM sessions WHERE token_hash = $1', [replacedHash]);
        await query('DELETE FROM sessions WHERE expires_at <= $1', [at]);
        await insertSession(query, id, session);
        await event(query, id, id, 'signed_in', at);
        return true;
      });
    },
    async sessionAccount(tokenHash) {
      const found = await run(
        'read session',
        `SELECT ${accountColumns('a')}, s.created_at AS session_created_at,
                s.expires_at AS session_expires_at
         FROM sessions s JOIN accounts a ON a.id = s.account_id
         WHERE s.token_hash = $1`,
        [tokenHash],
      );
      return found.rows[0] || null;
    },
    async deleteSession(tokenHash) {
      await run('sign out', 'DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
    },

    // New password chosen by the account itself: clears the forced change,
    // ends every session of the account and opens a fresh one (rotation).
    async changePassword(id, passwordHash, at, session) {
      return transaction('change password', async (query) => {
        const updated = await query(
          `UPDATE accounts SET password_hash = $3, must_change_password = false,
             failed_attempts = 0, locked_until = NULL, updated_at = $2
           WHERE id = $1 AND status = 'active' RETURNING ${columns}`,
          [id, at, passwordHash],
        );
        if (!updated.rows.length) return null;
        await query('DELETE FROM sessions WHERE account_id = $1', [id]);
        await insertSession(query, id, session);
        await event(query, id, id, 'password_changed', at);
        return updated.rows[0];
      });
    },

    // Inserts an account and its event, then runs during(account) before the
    // commit. If during throws (for example the Firestore profile write fails),
    // nothing is kept. A taken username is 409 USERNAME_TAKEN.
    async createAccount(
      { username, passwordHash, role, mustChangePassword, createdBy = null, action, at },
      during = null,
    ) {
      return transaction('create account', async (query) => {
        let inserted;
        try {
          inserted = await query(
            `INSERT INTO accounts (username, password_hash, role, must_change_password,
               created_at, updated_at, created_by)
             VALUES ($1, $2, $3, $4, $5, $5, $6) RETURNING ${columns}`,
            [username, passwordHash, role, mustChangePassword, at, createdBy],
          );
        } catch (error) {
          if (error?.code === uniqueViolation) throw accountErrors.usernameTaken();
          throw error;
        }
        const account = inserted.rows[0];
        await event(query, createdBy, account.id, action, at);
        if (during) await during(account);
        return account;
      });
    },

    // HR actions on employee accounts. Each returns the updated row, or null
    // when no employee account has that ID.
    async resetPassword(actorId, id, passwordHash, at) {
      return transaction('reset password', async (query) => {
        const updated = await query(
          `UPDATE accounts SET password_hash = $3, must_change_password = true,
             failed_attempts = 0, locked_until = NULL, updated_at = $2
           WHERE id = $1 AND role = 'employee' RETURNING ${columns}`,
          [id, at, passwordHash],
        );
        if (!updated.rows.length) return null;
        await query('DELETE FROM sessions WHERE account_id = $1', [id]);
        await event(query, actorId, id, 'password_reset', at);
        return updated.rows[0];
      });
    },
    async setStatus(actorId, id, status, at) {
      return transaction('set account status', async (query) => {
        const updated = await query(
          `UPDATE accounts SET status = $3, updated_at = $2
           WHERE id = $1 AND role = 'employee' RETURNING ${columns}`,
          [id, at, status],
        );
        if (!updated.rows.length) return null;
        if (status === 'disabled') await query('DELETE FROM sessions WHERE account_id = $1', [id]);
        await event(
          query,
          actorId,
          id,
          status === 'disabled' ? 'account_disabled' : 'account_enabled',
          at,
        );
        return updated.rows[0];
      });
    },
    // Records an event for an employee and runs during(account) before the
    // commit; returns null when no employee account has that ID.
    async employeeChange(actorId, id, action, at, during) {
      return transaction(action.replaceAll('_', ' '), async (query) => {
        const found = await query(
          `SELECT ${columns} FROM accounts WHERE id = $1 AND role = 'employee'`,
          [id],
        );
        const account = found.rows[0];
        if (!account) return null;
        await event(query, actorId, id, action, at);
        await during(account);
        return account;
      });
    },
    async employee(id) {
      const found = await run(
        'read employee',
        `SELECT ${columns} FROM accounts WHERE id = $1 AND role = 'employee'`,
        [id],
      );
      return found.rows[0] || null;
    },
    async listEmployees(limit = 500) {
      const found = await run(
        'list employees',
        `SELECT ${columns} FROM accounts WHERE role = 'employee'
         ORDER BY lower(username) LIMIT $1`,
        [limit],
      );
      return found.rows;
    },
    close: () => pool.end(),
  };
}
