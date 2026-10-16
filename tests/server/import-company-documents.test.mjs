import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULTS,
  UsageError,
  buildPlan,
  classifyFiles,
  importBody,
  importUrl,
  listLocalFiles,
  main,
  normalizePrefix,
  operationUrl,
  parseArgs,
  publicExposureWarning,
  rsyncArgs,
  summarizeOperation,
} from '../../scripts/import-company-documents.mjs';

test('arguments default to the live project and accept flags and environment overrides', () => {
  const defaults = parseArgs(['docs'], {});
  assert.deepEqual(
    { ...defaults },
    {
      folder: 'docs',
      apply: false,
      full: false,
      help: false,
      prefix: '',
      project: DEFAULTS.project,
      bucket: DEFAULTS.bucket,
      dataStore: DEFAULTS.dataStore,
    },
  );
  const env = parseArgs(['docs'], {
    GOOGLE_CLOUD_PROJECT: 'env-project-1',
    DOCS_BUCKET: 'env-bucket',
    VERTEX_SEARCH_DATA_STORE_ID: 'env-store',
  });
  assert.deepEqual(
    [env.project, env.bucket, env.dataStore],
    ['env-project-1', 'env-bucket', 'env-store'],
  );
  const flags = parseArgs(
    [
      '--apply',
      'docs',
      '--full',
      '--prefix',
      'handbook',
      '--bucket=my-bucket',
      '--project',
      'flag-project-1',
      '--data-store',
      'store_2',
    ],
    { DOCS_BUCKET: 'ignored-bucket' },
  );
  assert.equal(flags.apply, true);
  assert.equal(flags.full, true);
  assert.equal(flags.prefix, 'handbook/');
  assert.equal(flags.bucket, 'my-bucket');
  assert.equal(flags.project, 'flag-project-1');
  assert.equal(flags.dataStore, 'store_2');
});

test('bad arguments and unsafe names are rejected before anything runs', () => {
  const bad = (argv) => assert.throws(() => parseArgs(argv, {}), UsageError);
  bad([]);
  bad(['a', 'b']);
  bad(['a', '--nope']);
  bad(['a', '--prefix']);
  bad(['a', '--bucket', 'Bad Bucket']);
  bad(['a', '--bucket', 'x; rm -rf /']);
  bad(['a', '--data-store', '../store']);
  bad(['a', '--data-store', 'UPPER']);
  bad(['a', '--project', 'p;ls']);
  bad(['a', '--prefix', '../escape']);
  bad(['a', '--prefix', 'a/*']);
  bad(['a', '--prefix', 'a b/']);
  assert.equal(parseArgs(['--help'], {}).help, true);
  assert.equal(normalizePrefix('/handbook/2026'), 'handbook/2026/');
  assert.equal(normalizePrefix(''), '');
});

test('the import request targets the data store and the bucket path', () => {
  const options = parseArgs(['docs', '--prefix', 'handbook/'], {});
  assert.equal(
    importUrl(options),
    `https://discoveryengine.googleapis.com/v1/projects/${DEFAULTS.project}/locations/global/collections/default_collection/dataStores/onboardai-docs/branches/default_branch/documents:import`,
  );
  assert.deepEqual(importBody(options), {
    gcsSource: { inputUris: [`gs://${DEFAULTS.bucket}/handbook/**`], dataSchema: 'content' },
    reconciliationMode: 'INCREMENTAL',
  });
  const full = importBody(parseArgs(['docs', '--full'], {}));
  assert.equal(full.reconciliationMode, 'FULL');
  assert.deepEqual(full.gcsSource.inputUris, [`gs://${DEFAULTS.bucket}/**`]);
  assert.equal(
    operationUrl('projects/p/operations/import-1'),
    'https://discoveryengine.googleapis.com/v1/projects/p/operations/import-1',
  );
});

test('the upload is an argument array that never deletes bucket objects', () => {
  const args = rsyncArgs(parseArgs(['./my docs', '--prefix', 'hr/'], {}));
  assert.deepEqual(args.slice(0, 5), [
    'storage',
    'rsync',
    './my docs',
    `gs://${DEFAULTS.bucket}/hr/`,
    '--recursive',
  ]);
  assert.ok(args.includes('--exclude=(^|/)\\.'));
  assert.ok(!args.some((arg) => arg.includes('delete')));
});

test('hidden files are skipped and unsupported types only warn', () => {
  const result = classifyFiles([
    'b.PDF',
    'a.txt',
    '.DS_Store',
    'sub/.secret.pdf',
    '.git/config',
    'sub/notes.md',
    'x.docx',
  ]);
  assert.deepEqual(result.files, ['a.txt', 'b.PDF', 'sub/notes.md', 'x.docx']);
  assert.equal(result.hidden.length, 3);
  assert.deepEqual(result.unsupported, ['sub/notes.md']);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /sub\/notes\.md.*not a supported type/);
});

test('the plan lists files and commands, and warns for FULL and apply mode', () => {
  const classified = classifyFiles(['a.pdf', 'b.md']);
  const dry = buildPlan(parseArgs(['docs'], {}), classified);
  assert.match(dry, /DRY RUN/);
  assert.match(dry, /a\.pdf/);
  assert.match(dry, /gcloud storage rsync docs gs:\/\//);
  assert.match(dry, /INCREMENTAL/);
  assert.match(dry, /documents:import/);
  assert.ok(!dry.includes('REMOVED'));
  assert.ok(!dry.includes(publicExposureWarning));
  const applied = buildPlan(parseArgs(['docs', '--apply', '--full'], {}), classified);
  assert.ok(!applied.includes('DRY RUN'));
  assert.match(applied, /REMOVED/);
  assert.ok(applied.includes(publicExposureWarning));
});

test('operation results report counts, error samples and failure', () => {
  const ok = summarizeOperation({
    done: true,
    metadata: { successCount: '3', failureCount: '0' },
    response: {},
  });
  assert.deepEqual([ok.done, ok.successCount, ok.failureCount, ok.failed], [true, 3, 0, false]);
  const bad = summarizeOperation({
    done: true,
    metadata: { successCount: '1', failureCount: '2' },
    response: { errorSamples: [{ code: 3, message: 'bad pdf' }] },
  });
  assert.equal(bad.failed, true);
  assert.deepEqual(bad.errorSamples, ['3 bad pdf']);
  assert.equal(
    summarizeOperation({ done: true, error: { code: 7, message: 'denied' } }).failed,
    true,
  );
  assert.equal(summarizeOperation({}).done, false);
});

test('listing a folder walks subfolders, and a dry run makes no network call', async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'import-docs-'));
  const logs = [];
  const original = { log: console.log, fetch: globalThis.fetch };
  try {
    mkdirSync(path.join(folder, 'sub'));
    writeFileSync(path.join(folder, 'one.pdf'), 'x');
    writeFileSync(path.join(folder, 'sub', 'two.txt'), 'x');
    writeFileSync(path.join(folder, '.hidden.txt'), 'x');
    assert.deepEqual(listLocalFiles(folder).sort(), ['.hidden.txt', 'one.pdf', 'sub/two.txt']);
    console.log = (line) => logs.push(line);
    globalThis.fetch = () => assert.fail('a dry run must not use the network');
    assert.equal(await main([folder], {}), 0);
  } finally {
    console.log = original.log;
    globalThis.fetch = original.fetch;
    rmSync(folder, { recursive: true, force: true });
  }
  const output = logs.join('\n');
  assert.match(output, /DRY RUN/);
  assert.match(output, /one\.pdf/);
  assert.match(output, /Skipped hidden files: \.hidden\.txt/);
});
