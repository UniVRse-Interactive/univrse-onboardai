// npm run checklist-agent: starts the onboarding checklist agent (#51; Python,
// Google ADK) as an ADK API server with uv, on 127.0.0.1 at
// CHECKLIST_AGENT_PORT (8093 when unset). Point the api at it with
// CHECKLIST_AGENT_URL=http://127.0.0.1:8093.
// npm run checklist-agent:test: runs the agent's Python tests (no network, no
// Gemini, no Google credentials).
//
// Settings come from the repository .env (see .env.example). The agent gets
// only the variables it needs, never DATABASE_URL or other server secrets:
//   GOOGLE_CLOUD_PROJECT            required (Gemini on Vertex AI, as the server)
//   GOOGLE_CLOUD_LOCATION           Gemini's location, default global
//   CHECKLIST_AGENT_MODEL           default gemini-3.8-flash
//   FIRESTORE_PROJECT_ID            default GOOGLE_CLOUD_PROJECT
//   FIRESTORE_DATABASE_ID           default (default)
//   FIRESTORE_EMULATOR_HOST         required: the local agent only ever writes
//                                   to the Firestore emulator, like the server
// Credentials are Application Default Credentials (gcloud auth
// application-default login), as for the server.
//
// The ADK server keeps sessions, artifacts and memory in memory only (a
// session holds the employee's message; the api deletes it once the change is
// decided), logs at warning level, records no message content in its trace
// spans, and allows at most 8 model calls per run. Its endpoints have no
// authentication, so it listens on 127.0.0.1 only.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const AGENT_DIRECTORY = fileURLToPath(
  new URL('../agent-platform/onboarding-checklist', import.meta.url),
);
export const AGENT_HOST = '127.0.0.1';
export const AGENT_PORT = 8093;
export const DEFAULT_CHECKLIST_MODEL = 'gemini-3.8-flash';

// The port: CHECKLIST_AGENT_PORT when it is a valid port, else 8093.
export function agentPort(source = process.env) {
  const raw = (source.CHECKLIST_AGENT_PORT || '').trim();
  const port = Number(raw);
  return raw && Number.isInteger(port) && port > 0 && port < 65536 ? port : AGENT_PORT;
}

// Operating-system, proxy and credential-location variables uv, Python and
// Google's client libraries need to run.
const passThrough = [
  'PATH',
  'Path',
  'PATHEXT',
  'HOME',
  'USERPROFILE',
  'SystemRoot',
  'SYSTEMROOT',
  'COMSPEC',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'UV_CACHE_DIR',
  'UV_PYTHON_INSTALL_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'REQUESTS_CA_BUNDLE',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'CLOUDSDK_CONFIG',
];

// { env, problems }: the agent's environment, built from the server's.
export function agentEnvironment(source = process.env) {
  const value = (name) => (source[name] || '').trim();
  const problems = [];
  const project = value('GOOGLE_CLOUD_PROJECT');
  if (!project) problems.push('GOOGLE_CLOUD_PROJECT is not set (Gemini on Vertex AI needs it)');
  const vertex = value('GOOGLE_GENAI_USE_VERTEXAI') || 'TRUE';
  if (!['true', '1'].includes(vertex.toLowerCase()))
    problems.push('GOOGLE_GENAI_USE_VERTEXAI must be TRUE (Gemini runs on Vertex AI)');
  const emulator = value('FIRESTORE_EMULATOR_HOST');
  if (!emulator)
    problems.push(
      'FIRESTORE_EMULATOR_HOST is not set; the local checklist agent only writes to the Firestore emulator',
    );
  const env = {};
  for (const name of passThrough) if (source[name] !== undefined) env[name] = source[name];
  Object.assign(env, {
    GOOGLE_GENAI_USE_VERTEXAI: 'TRUE',
    GOOGLE_CLOUD_PROJECT: project,
    GOOGLE_CLOUD_LOCATION: value('GOOGLE_CLOUD_LOCATION') || 'global',
    CHECKLIST_AGENT_MODEL: value('CHECKLIST_AGENT_MODEL') || DEFAULT_CHECKLIST_MODEL,
    FIRESTORE_PROJECT_ID: value('FIRESTORE_PROJECT_ID') || project,
    FIRESTORE_DATABASE_ID: value('FIRESTORE_DATABASE_ID') || '(default)',
    FIRESTORE_EMULATOR_HOST: emulator,
    ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS: 'false',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUNBUFFERED: '1',
  });
  return { env, problems };
}

export const apiServerArguments = (port = AGENT_PORT) => [
  '--directory',
  AGENT_DIRECTORY,
  'run',
  '--locked',
  'adk',
  'api_server',
  '--host',
  AGENT_HOST,
  '--port',
  String(port),
  '--no-reload',
  '--log_level',
  'warning',
  '--session_service_uri',
  'memory://',
  '--artifact_service_uri',
  'memory://',
  '--memory_service_uri',
  'memory://',
  '--max_llm_calls',
  '8',
  '.',
];
export const testArguments = () => ['--directory', AGENT_DIRECTORY, 'run', '--locked', 'pytest'];

function run(args, env) {
  const child = spawn('uv', args, { env, stdio: 'inherit' });
  child.on('error', (error) => {
    console.error(
      error.code === 'ENOENT'
        ? 'uv is not installed or not on PATH. Install it (https://docs.astral.sh/uv/), then run this again.'
        : `Could not start uv (${error.code || error.name}).`,
    );
    process.exit(1);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--test')) {
    run(testArguments(), { ...process.env, PYTHONDONTWRITEBYTECODE: '1' });
  } else {
    if (existsSync('.env')) process.loadEnvFile('.env');
    const { env, problems } = agentEnvironment(process.env);
    if (problems.length) {
      console.error(`The checklist agent cannot start: ${problems.join('; ')}.`);
      console.error('Set the missing values in .env (see .env.example).');
      process.exit(1);
    }
    const port = agentPort(process.env);
    console.info(
      `Checklist agent: ADK API server at http://${AGENT_HOST}:${port}; model ` +
        `${env.CHECKLIST_AGENT_MODEL} on Vertex AI (${env.GOOGLE_CLOUD_LOCATION}); Firestore ` +
        `emulator ${env.FIRESTORE_EMULATOR_HOST}, project ${env.FIRESTORE_PROJECT_ID}. ` +
        `Set CHECKLIST_AGENT_URL=http://${AGENT_HOST}:${port} for the api.`,
    );
    run(apiServerArguments(port), env);
  }
}
