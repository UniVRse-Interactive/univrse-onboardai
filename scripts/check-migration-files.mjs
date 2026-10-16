// npm run db:migrations:check: lists the migration files and fails on any file a
// runner would silently skip or on a repeated number. No database, no network.
import { checkMigrationFiles } from '../server/migration-runner.mjs';

const { problems, listing, counts } = checkMigrationFiles();
for (const line of listing) console.log(line);
if (problems.length) {
  for (const problem of problems) console.error(`Migration file problem: ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`Migration files OK: sql ${counts.sql}, firestore ${counts.firestore}.`);
}
