// npm run checklist-agent:deploy -- <flags>: creates or updates the onboarding
// checklist agent (#51) on Vertex AI Agent Engine. It runs
// agent-platform/onboarding-checklist/deploy_agent_engine.py with uv and the
// agent's locked dependency groups (the Vertex AI SDK is in `deploy`):
//
//   --project <id> --location <region> --display-name <name>
//   --service-account <email> --firestore-database <id>
//   [--model <gemini model, default gemini-3.8-flash>]
//   [--gemini-location <location, default global>]
//
// Idempotent by display name. Credentials are Application Default Credentials
// (in GitHub Actions, the workload identity set up by
// google-github-actions/auth). The repository .env is not read: everything
// comes from the flags. Progress goes to standard error; the last line on
// standard output is only the resource name
// projects/…/locations/…/reasoningEngines/…, for example:
//
//   ENGINE=$(npm run --silent checklist-agent:deploy -- --project … | tail -n 1)
//
// The exit code is the deploy's: 0 deployed, 1 refused or failed, 2 bad flags.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AGENT_DIRECTORY } from './start-checklist-agent.mjs';

export const deployArguments = (flags = []) => [
  '--directory',
  AGENT_DIRECTORY,
  'run',
  '--locked',
  '--group',
  'deploy',
  'python',
  'deploy_agent_engine.py',
  ...flags,
];

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const child = spawn('uv', deployArguments(process.argv.slice(2)), {
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' },
    stdio: 'inherit',
  });
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
