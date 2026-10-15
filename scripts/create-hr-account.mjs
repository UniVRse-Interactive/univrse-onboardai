// npm run hr:create: creates an HR account, since there is no public sign-up.
//
// In a terminal it asks for the HR ID and the password twice; the password is
// not shown. Piped input is read as lines (HR ID, password, and optionally the
// password again), so it can be scripted:
//
//   printf '%s\n%s\n%s\n' HR-0001 "$PASSWORD" "$PASSWORD" | npm run hr:create
//
// The password is never accepted as a command-line argument, and it is never
// printed or logged. The new account does not need a forced password change.
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { createAccountStore, createDatabasePool } from '../server/account-store.mjs';
import { usernamePattern } from '../server/account-service.mjs';
import { hashPassword, passwordProblem } from '../server/password-hashing.mjs';

function stop(message) {
  console.error(message);
  process.exit(1);
}

if (process.argv.length > 2)
  stop(
    'npm run hr:create takes no arguments. It asks for the HR ID and password, or reads them from piped input.',
  );
if (existsSync('.env')) process.loadEnvFile('.env');
const databaseUrl = (process.env.DATABASE_URL || '').trim();
if (!databaseUrl) stop('Set DATABASE_URL in .env first (see .env.example).');

// Terminal prompts. While `hidden` is set, typed characters are not echoed.
function prompter() {
  let hidden = false;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!hidden) process.stdout.write(chunk, encoding);
      done();
    },
  });
  const lines = createInterface({ input: process.stdin, output, terminal: true });
  lines.on('SIGINT', () => {
    process.stdout.write('\n');
    process.exit(130);
  });
  return {
    ask(question, { secret = false } = {}) {
      return new Promise((resolve) => {
        process.stdout.write(question);
        hidden = secret;
        lines.question('', (answer) => {
          hidden = false;
          if (secret) process.stdout.write('\n');
          resolve(answer);
        });
      });
    },
    close: () => lines.close(),
  };
}

async function readPiped() {
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk;
    if (text.length > 4096) stop('The piped input is too long.');
  }
  const [username = '', password = '', confirmation] = text
    .split('\n')
    .map((line) => line.replace(/\r$/, ''));
  return {
    username,
    password,
    confirmation: confirmation === undefined || confirmation === '' ? password : confirmation,
  };
}

let entered;
if (process.stdin.isTTY) {
  const terminal = prompter();
  const username = await terminal.ask('HR ID: ');
  const password = await terminal.ask('Password: ', { secret: true });
  const confirmation = await terminal.ask('Password again: ', { secret: true });
  terminal.close();
  entered = { username, password, confirmation };
} else entered = await readPiped();

const username = entered.username.trim();
if (!usernamePattern.test(username))
  stop('Use an HR ID of 3 to 32 letters, numbers, dots, hyphens or underscores.');
const problem = passwordProblem(entered.password, username);
if (problem) stop(problem);
if (entered.password !== entered.confirmation) stop('The two passwords do not match.');

const store = createAccountStore({ pool: createDatabasePool(databaseUrl), log: () => {} });
try {
  const account = await store.createAccount({
    username,
    passwordHash: await hashPassword(entered.password),
    role: 'hr',
    mustChangePassword: false,
    createdBy: null,
    action: 'hr_account_created',
    at: new Date(),
  });
  console.log(`Created HR account ${account.username} (${account.id}).`);
} catch (error) {
  process.exitCode = 1;
  if (error.code === 'USERNAME_TAKEN') console.error('That HR ID is already in use.');
  else
    console.error(
      'The HR account could not be created. Check that the database is running (npm run db:up) and migrated (npm run db:migrate).',
    );
} finally {
  await store.close();
}
