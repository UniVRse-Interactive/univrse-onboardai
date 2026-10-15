// npm run docs:import -- <local-folder> [--apply] [--full] [--prefix handbook/]
//   [--project ID] [--bucket NAME] [--data-store ID]
// Uploads a folder of company documents to the Cloud Storage documents bucket with
// `gcloud storage rsync`, then imports them into the Vertex AI Search data store through
// the Discovery Engine REST API. Without --apply it only prints what it would do.
import { execFile } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const DEFAULTS = {
  project: 'project-65a9b676-abdb-4393-bc1',
  bucket: 'project-65a9b676-abdb-4393-bc1-onboardai-docs',
  dataStore: 'onboardai-docs',
};
const API = 'https://discoveryengine.googleapis.com/v1';
const COLLECTION = 'default_collection';
const BRANCH = 'default_branch';
export const SUPPORTED_EXTENSIONS = ['pdf', 'docx', 'pptx', 'xlsx', 'html', 'htm', 'txt'];
const POLL_INTERVAL_MS = 5000;
const POLL_LIMIT_MS = 30 * 60 * 1000;

export const USAGE = `Usage: npm run docs:import -- <local-folder> [options]

Uploads the folder to the Cloud Storage documents bucket (gcloud storage rsync, never
deleting bucket objects) and imports it into the Vertex AI Search data store.
Without --apply nothing is changed: the plan and the commands are printed.

Options:
  --apply              Run the upload and the import (default: dry run)
  --full               Import with reconciliationMode FULL: indexed documents that are no
                       longer in the bucket are removed. Default is INCREMENTAL.
  --prefix <folder/>   Bucket folder to upload into and import from (default: bucket root)
  --project <id>       Default ${DEFAULTS.project} (env GOOGLE_CLOUD_PROJECT)
  --bucket <name>      Default ${DEFAULTS.bucket} (env DOCS_BUCKET)
  --data-store <id>    Default ${DEFAULTS.dataStore} (env VERTEX_SEARCH_DATA_STORE_ID)
  --help               Show this text

Supported types: ${SUPPORTED_EXTENSIONS.join(', ')}. Hidden files are skipped.`;

export class UsageError extends Error {}

const PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const BUCKET = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;
const DATA_STORE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const PREFIX = /^([A-Za-z0-9_-][A-Za-z0-9._-]*\/)+$/;

export function normalizePrefix(value) {
  let prefix = String(value ?? '').trim();
  if (!prefix) return '';
  prefix = prefix.replace(/^\/+/, '');
  if (prefix && !prefix.endsWith('/')) prefix += '/';
  if (!PREFIX.test(prefix) || prefix.split('/').some((part) => part === '..')) {
    throw new UsageError(
      `Invalid --prefix "${value}": use folder names of letters, digits, ".", "_" and "-", e.g. handbook/`,
    );
  }
  return prefix;
}

export function parseArgs(argv, env = {}) {
  const options = {
    folder: null,
    apply: false,
    full: false,
    help: false,
    prefix: '',
    project: env.GOOGLE_CLOUD_PROJECT || DEFAULTS.project,
    bucket: env.DOCS_BUCKET || DEFAULTS.bucket,
    dataStore: env.VERTEX_SEARCH_DATA_STORE_ID || DEFAULTS.dataStore,
  };
  const values = {
    '--prefix': 'prefix',
    '--project': 'project',
    '--bucket': 'bucket',
    '--data-store': 'dataStore',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inline] = arg.startsWith('--') ? arg.split(/=(.*)/s, 2) : [arg];
    if (flag === '--apply') options.apply = true;
    else if (flag === '--full') options.full = true;
    else if (flag === '--help' || arg === '-h') options.help = true;
    else if (values[flag]) {
      const value = inline ?? argv[++i];
      if (value === undefined || value.startsWith('--'))
        throw new UsageError(`${flag} needs a value`);
      options[values[flag]] = value;
    } else if (arg.startsWith('-')) throw new UsageError(`Unknown option ${arg}`);
    else if (options.folder === null) options.folder = arg;
    else throw new UsageError(`Unexpected extra argument "${arg}"`);
  }
  if (options.help) return options;
  if (!options.folder) throw new UsageError('A local folder is required');
  if (!PROJECT.test(options.project))
    throw new UsageError(`Invalid project ID "${options.project}"`);
  if (!BUCKET.test(options.bucket)) throw new UsageError(`Invalid bucket name "${options.bucket}"`);
  if (!DATA_STORE.test(options.dataStore)) {
    throw new UsageError(`Invalid data store ID "${options.dataStore}"`);
  }
  options.prefix = normalizePrefix(options.prefix);
  return options;
}

export const extensionOf = (name) => path.extname(name).slice(1).toLowerCase();
export const isHidden = (relativePath) =>
  relativePath.split(/[\\/]/).some((part) => part.startsWith('.'));

// files: relative paths. Hidden ones are skipped; unsupported types only produce a warning.
export function classifyFiles(files) {
  const hidden = files.filter(isHidden);
  const kept = files.filter((file) => !isHidden(file)).sort();
  const unsupported = kept.filter((file) => !SUPPORTED_EXTENSIONS.includes(extensionOf(file)));
  return {
    files: kept,
    hidden,
    unsupported,
    warnings: unsupported.map(
      (file) =>
        `Warning: ${file} is not a supported type (${SUPPORTED_EXTENSIONS.join(', ')}); ` +
        'it is uploaded but may not be indexed.',
    ),
  };
}

export function listLocalFiles(folder) {
  const found = [];
  const walk = (dir, relative) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), next);
      else if (entry.isFile()) found.push(next);
    }
  };
  if (!statSync(folder).isDirectory()) throw new UsageError(`${folder} is not a folder`);
  walk(folder, '');
  return found;
}

export const bucketUri = ({ bucket, prefix }) => `gs://${bucket}/${prefix}`;

// Never includes --delete-unmatched-destination-objects: the bucket is only ever added to.
export function rsyncArgs(options) {
  return [
    'storage',
    'rsync',
    options.folder,
    bucketUri(options),
    '--recursive',
    '--exclude=(^|/)\\.',
    `--project=${options.project}`,
  ];
}

export const importUrl = ({ project, dataStore }) =>
  `${API}/projects/${project}/locations/global/collections/${COLLECTION}/dataStores/${dataStore}` +
  `/branches/${BRANCH}/documents:import`;

export const importBody = (options) => ({
  gcsSource: { inputUris: [`${bucketUri(options)}**`], dataSchema: 'content' },
  reconciliationMode: options.full ? 'FULL' : 'INCREMENTAL',
});

export const operationUrl = (name) => `${API}/${String(name).replace(/^\/+/, '')}`;

export const publicExposureWarning =
  'The web and api services are public until IAP (#10) is in place, so indexed documents ' +
  'can be quoted to anyone who uses the chat. Upload only documents that are approved to share.';

export const fullWarning =
  'WARNING: --full uses reconciliationMode FULL. Indexed documents that are no longer in the ' +
  'bucket (under this import path) are REMOVED from the data store.';

export function buildPlan(options, classified) {
  const lines = [
    options.apply ? 'Import plan' : 'DRY RUN - nothing will be changed. Add --apply to run.',
  ];
  lines.push(
    `Project:    ${options.project}`,
    `Bucket:     ${bucketUri(options)}`,
    `Data store: ${options.dataStore} (global, ${COLLECTION}, ${BRANCH})`,
    `Mode:       ${options.full ? 'FULL' : 'INCREMENTAL'}`,
    '',
    `Files to upload (${classified.files.length}):`,
    ...classified.files.map((file) => `  ${file}`),
  );
  if (classified.hidden.length) lines.push(`Skipped hidden files: ${classified.hidden.join(', ')}`);
  lines.push(...classified.warnings);
  if (options.full) lines.push('', fullWarning);
  lines.push(
    '',
    'Step 1, upload (never deletes bucket objects):',
    `  ${['gcloud', ...rsyncArgs(options)].join(' ')}`,
    'Step 2, import:',
    `  POST ${importUrl(options)}`,
    '  Authorization: Bearer $(gcloud auth print-access-token)',
    `  x-goog-user-project: ${options.project}`,
    `  ${JSON.stringify(importBody(options))}`,
    'Step 3, poll until done:',
    '  GET https://discoveryengine.googleapis.com/v1/<operation name>',
  );
  if (options.apply) lines.push('', publicExposureWarning);
  return lines.join('\n');
}

// Reads a finished (or running) long-running operation from documents:import.
export function summarizeOperation(operation) {
  const count = (value) => Number(value ?? 0) || 0;
  const metadata = operation?.metadata ?? {};
  const response = operation?.response ?? {};
  const samples = response.errorSamples ?? metadata.errorSamples ?? [];
  const failureCount = count(metadata.failureCount);
  return {
    done: operation?.done === true,
    successCount: count(metadata.successCount),
    failureCount,
    errorSamples: samples.map((sample) => `${sample.code ?? ''} ${sample.message ?? ''}`.trim()),
    error: operation?.error
      ? `${operation.error.code ?? ''} ${operation.error.message ?? ''}`.trim()
      : null,
    failed: Boolean(operation?.error) || failureCount > 0,
  };
}

async function gcloud(args) {
  try {
    const { stdout } = await run('gcloud', args, { maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const detail = [error.stderr, error.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`gcloud ${args[0]} ${args[1] ?? ''} failed: ${detail || error.message}`);
  }
}

async function upload(options) {
  // gcloud writes progress to stderr; the full output is shown, including on failure.
  const args = rsyncArgs(options);
  console.log(`\nUploading with: gcloud ${args.join(' ')}`);
  const { stdout, stderr } = await run('gcloud', args, { maxBuffer: 16 * 1024 * 1024 }).catch(
    (error) => {
      throw new Error(
        `gcloud storage rsync failed: ${[error.stderr, error.stdout].join('\n').trim() || error.message}`,
      );
    },
  );
  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.log(stderr.trim());
}

async function authedFetch(url, options, init = {}) {
  const token = (await gcloud(['auth', 'print-access-token'])).trim();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'x-goog-user-project': options.project,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`HTTP ${response.status} from ${init.method ?? 'GET'} ${url}\n${text}`);
  return JSON.parse(text);
}

async function importDocuments(options) {
  console.log('\nStarting the import...');
  const started = await authedFetch(importUrl(options), options, {
    method: 'POST',
    body: JSON.stringify(importBody(options)),
  });
  console.log(`Operation: ${started.name}`);
  const deadline = Date.now() + POLL_LIMIT_MS;
  let operation = started;
  while (!operation.done) {
    if (Date.now() > deadline)
      throw new Error(`Import still running after 30 minutes: ${started.name}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    operation = await authedFetch(operationUrl(started.name), options);
  }
  return summarizeOperation(operation);
}

export async function main(argv, env = process.env) {
  let options;
  try {
    options = parseArgs(argv, env);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  let classified;
  try {
    classified = classifyFiles(listLocalFiles(options.folder));
  } catch (error) {
    console.error(`Cannot read ${options.folder}: ${error.message}`);
    return 2;
  }
  if (!classified.files.length) {
    console.error(`No files to upload in ${options.folder}.`);
    return 2;
  }
  console.log(buildPlan(options, classified));
  if (!options.apply) return 0;

  try {
    await upload(options);
    const result = await importDocuments(options);
    console.log(
      `\nImport finished: ${result.successCount} succeeded, ${result.failureCount} failed.`,
    );
    for (const sample of result.errorSamples) console.log(`  error sample: ${sample}`);
    if (result.error) console.log(`  operation error: ${result.error}`);
    if (result.failed) return 1;
    console.log('Done. New documents can take a few minutes to appear in search.');
    return 0;
  } catch (error) {
    console.error(`\n${error.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
