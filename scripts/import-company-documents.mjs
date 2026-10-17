// npm run docs:import -- <local-folder> --prefix handbook/ [--apply]
//   [--project ID] [--bucket NAME] [--data-store ID]
// Local, operator-only: uploads a folder of company documents to a named folder of the
// Cloud Storage documents bucket with `gcloud storage rsync`, then imports that folder into
// the Vertex AI Search data store through the Discovery Engine REST API (INCREMENTAL only).
// Without --apply it only prints what it would do. HR's own documents live in <uuid>/
// folders that the app manages: this tool refuses the bucket root, any <uuid>/ folder and
// FULL reconciliation, so it can never re-import or remove them.
import { execFile } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  SUPPORTED_EXTENSIONS,
  companyDocumentIdPattern,
  discoveryEngineOperationUrl,
  extensionOf,
  importUrl,
} from '../server/discovery-engine-documents.mjs';

export { SUPPORTED_EXTENSIONS, extensionOf, importUrl };

const run = promisify(execFile);

export const DEFAULTS = {
  project: 'project-65a9b676-abdb-4393-bc1',
  bucket: 'project-65a9b676-abdb-4393-bc1-onboardai-docs',
  dataStore: 'onboardai-docs',
};
const COLLECTION = 'default_collection';
const BRANCH = 'default_branch';
const POLL_INTERVAL_MS = 5000;
const POLL_LIMIT_MS = 30 * 60 * 1000;

export const USAGE = `Usage: npm run docs:import -- <local-folder> --prefix <folder/> [options]

Local, operator-only. Uploads the folder into one named folder of the Cloud Storage
documents bucket (gcloud storage rsync, never deleting bucket objects) and imports that
folder into the Vertex AI Search data store (INCREMENTAL). Without --apply nothing is
changed: the plan and the commands are printed. HR uploads documents on the Company
Documentation page instead; those live in <document id>/ folders this tool never touches.

Options:
  --prefix <folder/>   Required. The bucket folder to upload into and import from. Never the
                       bucket root and never a <document id>/ (UUID) folder.
  --apply              Run the upload and the import (default: dry run)
  --project <id>       Default ${DEFAULTS.project} (env GOOGLE_CLOUD_PROJECT)
  --bucket <name>      Default ${DEFAULTS.bucket} (env DOCS_BUCKET)
  --data-store <id>    Default ${DEFAULTS.dataStore} (env VERTEX_SEARCH_DATA_STORE_ID)
  --help               Show this text

The data store's location is VERTEX_SEARCH_LOCATION (default global). --full (FULL
reconciliation) is refused: it would remove every indexed document outside the folder.

Supported types: ${SUPPORTED_EXTENSIONS.join(', ')}. Hidden files are skipped.`;

export class UsageError extends Error {}

const PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const BUCKET = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;
const DATA_STORE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const LOCATION = /^[a-z0-9-]+$/;
const PREFIX = /^([A-Za-z0-9_-][A-Za-z0-9._-]*\/)+$/;
// The HR namespace: the first folder is a document ID (any letter case).
const UUID_FOLDER = new RegExp(companyDocumentIdPattern.source, 'i');

// A bucket folder ("handbook" -> "handbook/"). The bucket root (an empty
// prefix) and the app's <document id>/ folders are refused (D-2): an import
// there would re-index HR's documents, orphans included.
export function normalizePrefix(value) {
  let prefix = String(value ?? '').trim();
  prefix = prefix.replace(/^\/+/, '');
  if (!prefix)
    throw new UsageError(
      '--prefix is required: name the bucket folder to import, e.g. --prefix handbook/. ' +
        'The bucket root holds the HR documents the app manages and is never imported.',
    );
  if (!prefix.endsWith('/')) prefix += '/';
  if (!PREFIX.test(prefix) || prefix.split('/').some((part) => part === '..')) {
    throw new UsageError(
      `Invalid --prefix "${value}": use folder names of letters, digits, ".", "_" and "-", e.g. handbook/`,
    );
  }
  if (UUID_FOLDER.test(prefix.split('/')[0]))
    throw new UsageError(
      `Invalid --prefix "${value}": <document id>/ folders belong to the HR documents the app ` +
        'manages. Upload or replace those on the Company Documentation page.',
    );
  return prefix;
}

export function parseArgs(argv, env = {}) {
  const options = {
    folder: null,
    apply: false,
    help: false,
    prefix: '',
    project: env.GOOGLE_CLOUD_PROJECT || DEFAULTS.project,
    bucket: env.DOCS_BUCKET || DEFAULTS.bucket,
    dataStore: env.VERTEX_SEARCH_DATA_STORE_ID || DEFAULTS.dataStore,
    location: String(env.VERTEX_SEARCH_LOCATION || '').trim() || 'global',
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
    else if (flag === '--full')
      throw new UsageError(
        '--full is not supported: a FULL import removes every indexed document outside the ' +
          'imported folder, including the HR documents the app manages.',
      );
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
  if (!LOCATION.test(options.location))
    throw new UsageError(`Invalid VERTEX_SEARCH_LOCATION "${options.location}"`);
  options.prefix = normalizePrefix(options.prefix);
  return options;
}

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

// Always INCREMENTAL, and always one named folder (normalizePrefix refuses the
// root and the <document id>/ folders).
export const importBody = (options) => {
  if (!options.prefix) throw new UsageError('--prefix is required');
  return {
    gcsSource: { inputUris: [`${bucketUri(options)}**`], dataSchema: 'content' },
    reconciliationMode: 'INCREMENTAL',
  };
};

export const operationUrl = (name, location = 'global') =>
  discoveryEngineOperationUrl(location, name);

export const publicExposureWarning =
  'The web and api services are public until IAP (#10) is in place, so indexed documents ' +
  'can be quoted to anyone who uses the chat. Upload only documents that are approved to share.';

export function buildPlan(options, classified) {
  const lines = [
    options.apply ? 'Import plan' : 'DRY RUN - nothing will be changed. Add --apply to run.',
  ];
  lines.push(
    `Project:    ${options.project}`,
    `Bucket:     ${bucketUri(options)}`,
    `Data store: ${options.dataStore} (${options.location}, ${COLLECTION}, ${BRANCH})`,
    'Mode:       INCREMENTAL',
    '',
    `Files to upload (${classified.files.length}):`,
    ...classified.files.map((file) => `  ${file}`),
  );
  if (classified.hidden.length) lines.push(`Skipped hidden files: ${classified.hidden.join(', ')}`);
  lines.push(...classified.warnings);
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
    `  GET ${operationUrl('<operation name>', options.location)}`,
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
    operation = await authedFetch(operationUrl(started.name, options.location), options);
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
