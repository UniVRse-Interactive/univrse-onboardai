import { firestoreConfig } from './firestore-client.mjs';

// Accounts (HR and employee sign-in) turn on only when DATABASE_URL is set.
// Without it the app behaves as before and every account endpoint answers 503
// ACCOUNTS_NOT_CONFIGURED.
//
// With accounts on, employee profiles and account chats are stored in Firestore,
// so FIRESTORE_DATABASE_ID (and a project) are required. Outside Cloud Run
// (K_SERVICE unset) the Firestore emulator is required too, so local test
// personal data can never reach a cloud Firestore database.
export class AccountsConfigError extends Error {}

export function accountSettings(env = process.env) {
  const databaseUrl = (env.DATABASE_URL || '').trim();
  if (!databaseUrl) return null;
  const problems = [];
  // Only the scheme is checked: the Cloud SQL socket form
  // postgresql://USER:PASS@/DB?host=/cloudsql/... has an empty host, which
  // new URL() rejects. pg parses it. The value is never echoed (it has a password).
  if (!/^postgres(ql)?:\/\/\S+$/i.test(databaseUrl))
    problems.push('DATABASE_URL must be a postgresql:// connection URL');
  const firestore = firestoreConfig(env);
  if (!firestore)
    problems.push(
      'FIRESTORE_DATABASE_ID is not set (employee profiles and account chats are stored in Firestore)',
    );
  else if (!firestore.projectId)
    problems.push('FIRESTORE_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) is not set');
  const emulator = (env.FIRESTORE_EMULATOR_HOST || '').trim();
  if (!env.K_SERVICE && !emulator)
    problems.push(
      'FIRESTORE_EMULATOR_HOST is not set; outside Cloud Run, accounts only run against the local Firestore emulator so test personal data never reaches cloud Firestore',
    );
  if (problems.length)
    throw new AccountsConfigError(
      `Accounts are turned on because DATABASE_URL is set, but ${problems.join('; ')}. ` +
        'Set the missing values in .env (see .env.example), or remove DATABASE_URL to run without accounts.',
    );
  return { databaseUrl, firestore, emulator: emulator || null };
}

// One line for the start-up log. Never includes DATABASE_URL (it holds a password).
export function describeAccounts(env = process.env) {
  const settings = accountSettings(env);
  if (!settings) return 'off (DATABASE_URL is not set)';
  const where = settings.emulator
    ? `the Firestore emulator at ${settings.emulator}`
    : `Firestore database ${settings.firestore.databaseId}`;
  return `on (PostgreSQL; profiles in ${where}, project ${settings.firestore.projectId})`;
}
