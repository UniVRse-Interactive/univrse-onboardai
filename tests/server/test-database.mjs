// In-process PostgreSQL for account tests: pg-mem running the real migration
// files through the real migration runner. No Docker, no network.
//
// pg-mem lacks a few PostgreSQL built-ins, added here: gen_random_uuid(), the
// `~` regular-expression operator used by CHECK constraints, and
// pg_advisory_xact_lock(). Its pg adapter also commits every query on its own,
// so this pool provides transactions: BEGIN takes a snapshot, ROLLBACK
// restores it, COMMIT keeps the changes. Transactions run one at a time. The
// live run against the Docker PostgreSQL proves the same SQL on the real engine.
import { randomUUID } from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { migrate } from '../../server/database-migrations.mjs';

export async function createTestDatabase() {
  const db = newDb();
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    implementation: randomUUID,
    impure: true,
  });
  db.public.registerFunction({
    name: 'pg_advisory_xact_lock',
    args: [DataType.integer],
    returns: DataType.integer,
    implementation: () => 0,
    impure: true,
  });
  db.public.registerOperator({
    operator: '~',
    left: DataType.text,
    right: DataType.text,
    returns: DataType.bool,
    implementation: (value, pattern) => new RegExp(pattern).test(value),
  });
  const { Pool } = db.adapters.createPg();
  const inner = new Pool();
  const faults = [];
  let queue = Promise.resolve();
  const statements = [];

  async function query(text, values) {
    statements.push(typeof text === 'string' ? text : text.text);
    const fault = faults.find((f) => f.times > 0 && (!f.match || f.match.test(text)));
    if (fault) {
      fault.times--;
      throw Object.assign(new Error('Injected database failure with a private value'), {
        code: fault.code,
      });
    }
    return inner.query(text, values);
  }

  const pool = {
    query,
    async connect() {
      let snapshot = null,
        finish = null;
      return {
        async query(text, values) {
          const command = typeof text === 'string' ? text.trim().toUpperCase() : '';
          if (command === 'BEGIN') {
            const previous = queue;
            queue = new Promise((resolve) => (finish = resolve));
            await previous;
            snapshot = db.backup();
            return { rows: [], rowCount: 0 };
          }
          if (command === 'COMMIT' || command === 'ROLLBACK') {
            if (command === 'ROLLBACK') snapshot?.restore();
            snapshot = null;
            finish?.();
            finish = null;
            return { rows: [], rowCount: 0 };
          }
          return query(text, values);
        },
        release() {
          finish?.();
        },
      };
    },
    end: async () => {},
  };
  const migrated = await migrate(pool);
  return {
    db,
    pool,
    migrated,
    statements,
    // The next `times` queries (optionally only those matching `match`) fail
    // with this SQLSTATE, like a lost database connection.
    fail(code = '57P01', { times = 1, match = null } = {}) {
      faults.push({ code, times, match });
    },
    rows: (sql, values) => inner.query(sql, values).then((result) => result.rows),
  };
}
