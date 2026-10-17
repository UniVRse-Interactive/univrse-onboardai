// npm run local / local:reset-hr / local:down / local:logs: runs the app in
// Docker (compose.yaml: web, api, tts, the onboarding checklist agent and the
// databases) and shows the local HR login that server/local-setup.mjs wrote to
// .cache/local-stack/hr-login.json. Local only.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

export const setupDirectory = join('.cache', 'local-stack');
export const loginFile = join(setupDirectory, 'hr-login.json');
const resetHint = 'npm run local:reset-hr';

// Default runner: returns { status, stdout }. `inherit` streams the output.
export function runCommand(command, args, { inherit = false, env = {} } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  return { status: result.error ? 127 : (result.status ?? 1), stdout: result.stdout || '' };
}

const dockerRunning = (run) => run('docker', ['info']).status === 0;

// Makes sure the Docker daemon answers. On macOS it starts Docker Desktop and
// waits up to timeoutMs. Returns { ok, message }.
export async function ensureDocker({
  run = runCommand,
  platform = process.platform,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  log = console.log,
  timeoutMs = 120000,
  intervalMs = 2000,
} = {}) {
  if (dockerRunning(run)) return { ok: true };
  if (platform !== 'darwin')
    return {
      ok: false,
      message: 'Docker is not running or not installed. Start Docker, then run this again.',
    };
  log('Docker is not running; starting Docker Desktop...');
  if (run('open', ['-a', 'Docker']).status !== 0)
    return { ok: false, message: 'Could not start Docker Desktop. Install or open it yourself.' };
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    await sleep(intervalMs);
    if (dockerRunning(run)) return { ok: true };
  }
  return {
    ok: false,
    message: `Docker did not become ready within ${Math.round(timeoutMs / 1000)} s. Check Docker Desktop (and DOCKER_CONTEXT if you set it).`,
  };
}

export function renderSummary(
  login,
  { webPort = process.env.LOCAL_WEB_PORT || '3100', adc = true } = {},
) {
  const rows = [['App', `http://localhost:${webPort}`]];
  if (login) rows.push(['HR ID', login.hrId], ['HR password', login.password]);
  rows.push(
    ['Emulator UI', login?.emulatorUiUrl || 'http://localhost:4000'],
    ['Postgres', '127.0.0.1:5442'],
    ['Gemini autofill', adc ? 'on' : 'off (no Google login)'],
  );
  const lines = rows.map(([label, value]) => `  ${label.padEnd(16)} ${value}`);
  if (!login) {
    lines.push(
      '',
      '  The HR password is not stored on this machine.',
      `  Run ${resetHint} to set a new one and show it.`,
    );
  }
  if (!adc)
    lines.push(
      '',
      '  Gemini autofill is off: run `gcloud auth application-default login`, then `npm run local` again.',
    );
  lines.push(
    '',
    '  Stop the app:  npm run local:down  (the databases keep running)',
    '  See logs:      npm run local:logs',
  );
  const width = Math.max(...lines.map((line) => line.length)) + 2;
  const rule = '='.repeat(width);
  return [rule, '  OnboardAi is running locally', rule, ...lines, rule].join('\n');
}

async function readLogin(read, path) {
  try {
    const data = JSON.parse(await read(path, 'utf8'));
    return data && typeof data.password === 'string' && data.password ? data : null;
  } catch {
    return null;
  }
}

export const placeholderFile = resolve(setupDirectory, 'no-adc.json');

export const missingProjectMessage =
  'GOOGLE_CLOUD_PROJECT is not set: add it to .env (Gemini on Vertex AI needs it)';
const readDotEnv = (path = '.env') =>
  existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};

// The Google Cloud project for Gemini (the api's answers, autofill and voice,
// and the checklist agent): the environment, then .env, then
// `gcloud config get-value project`. Returns { project, source }, with a null
// project when none of them has one.
export function resolveProject({ env = process.env, dotEnv = readDotEnv, run = runCommand } = {}) {
  const fromEnv = (env.GOOGLE_CLOUD_PROJECT || '').trim();
  if (fromEnv) return { project: fromEnv, source: 'environment' };
  let fromFile = '';
  try {
    fromFile = (dotEnv().GOOGLE_CLOUD_PROJECT || '').trim();
  } catch {
    // An unreadable .env is like a missing one.
  }
  if (fromFile) return { project: fromFile, source: '.env' };
  const gcloud = run('gcloud', ['config', 'get-value', 'project']);
  const value = gcloud.status === 0 ? (gcloud.stdout || '').trim().split('\n').at(-1).trim() : '';
  if (value && value !== '(unset)') return { project: value, source: 'gcloud' };
  return { project: null, source: null };
}

// Picks the Google credentials file to mount into the api container. Only
// checks that a file exists; never reads it. Without one, a `{}` placeholder
// keeps the bind mount valid. Returns { file, found }.
export async function resolveAdcFile({
  env = process.env,
  home = homedir(),
  exists = existsSync,
  writeText = (path, text) => writeFile(path, text, { mode: 0o600 }),
} = {}) {
  const configured = env.GOOGLE_APPLICATION_CREDENTIALS
    ? resolve(env.GOOGLE_APPLICATION_CREDENTIALS)
    : null;
  if (configured && exists(configured)) return { file: configured, found: true };
  const fallback = join(home, '.config', 'gcloud', 'application_default_credentials.json');
  if (exists(fallback)) return { file: fallback, found: true };
  await writeText(placeholderFile, '{}\n');
  return { file: placeholderFile, found: false };
}

// The Firestore emulator image tag. Must match compose.yaml (the firestore
// service image and the firebase-emulator-image builder).
export const emulatorImage = 'onboardai-local-firebase-emulator:15.34.0';

const compose = (...args) => ['compose', ...args];
export const commands = {
  inspectEmulator: ['image', 'inspect', emulatorImage],
  buildEmulator: compose('--profile', 'emulator-image', 'build', 'firebase-emulator-image'),
  build: compose('build'),
  up: compose('up', '-d', '--wait', 'web'),
  reset: compose('run', '--rm', '-e', 'LOCAL_HR_RESET=1', 'setup'),
  down: compose('stop', 'web', 'api', 'tts', 'checklist-agent'),
  logs: compose('logs', '-f', 'web', 'api', 'tts', 'checklist-agent', 'setup'),
};

// Runs one command. Returns { exitCode }; messages go through out/err.
export async function runLocal(
  command,
  {
    run = runCommand,
    mkdirp = (path) => mkdir(path, { recursive: true }),
    read = readFile,
    adcOptions = {},
    projectOptions = {},
    platform = process.platform,
    sleep,
    now,
    out = console.log,
    err = console.error,
  } = {},
) {
  let env = {};
  const docker = (args) => run('docker', args, { inherit: true, env }).status === 0;
  const quiet = (args) => run('docker', args, { env }).status === 0;
  const fail = (message) => {
    err(message);
    return { exitCode: 1 };
  };
  if (!['start', 'reset', 'down', 'logs'].includes(command))
    return fail('Usage: node scripts/local-stack.mjs start|reset|down|logs');
  const ready = await ensureDocker({ run, platform, sleep, now, log: out });
  if (!ready.ok) return fail(ready.message);

  await mkdirp(setupDirectory);
  const adc = await resolveAdcFile(adcOptions);
  env = { LOCAL_ADC_FILE: adc.file };

  if (command === 'down') {
    if (!docker(commands.down)) return fail('Could not stop the app containers.');
    out(
      'Stopped web, api, tts and checklist-agent. PostgreSQL and the Firestore emulator are still running.',
    );
    return { exitCode: 0 };
  }
  if (command === 'logs') return { exitCode: docker(commands.logs) ? 0 : 1 };

  if (command === 'start') {
    // Without a project the api would start with an empty one and Gemini
    // (answers, autofill, voice, the checklist agent) would fail later.
    const { project, source } = resolveProject({ run, ...projectOptions });
    if (!project) return fail(missingProjectMessage);
    env = { ...env, GOOGLE_CLOUD_PROJECT: project };
    out(`Gemini project: ${project} (from ${source}).`);
    // Built only the first time: rebuilding it would make Docker Compose
    // recreate the running Firestore container.
    if (!quiet(commands.inspectEmulator) && !docker(commands.buildEmulator))
      return fail('Building the Firestore emulator image failed. See the output above.');
    if (!docker(commands.build)) return fail('Docker build failed. See the output above.');
    if (!docker(commands.up))
      return fail('The stack did not become healthy. Run npm run local:logs to see why.');
  } else if (!docker(commands.reset)) {
    return fail('The HR password reset failed. Run npm run local:logs to see why.');
  }
  out(renderSummary(await readLogin(read, loginFile), { adc: adc.found }));
  return { exitCode: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const { exitCode } = await runLocal(process.argv[2]);
  process.exitCode = exitCode;
}
