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
  const defaults = parseArgs(['docs', '--prefix', 'handbook'], {});
  assert.deepEqual(
    { ...defaults },
    {
      folder: 'docs',
      apply: false,
      help: false,
      prefix: 'handbook/',
      project: DEFAULTS.project,
      bucket: DEFAULTS.bucket,
      dataStore: DEFAULTS.dataStore,
      location: 'global',
    },
  );
  const env = parseArgs(['docs', '--prefix=handbook/'], {
    GOOGLE_CLOUD_PROJECT: 'env-project-1',
    DOCS_BUCKET: 'env-bucket',
    VERTEX_SEARCH_DATA_STORE_ID: 'env-store',
    VERTEX_SEARCH_LOCATION: 'eu',
  });
  assert.deepEqual(
    [env.project, env.bucket, env.dataStore, env.location],
    ['env-project-1', 'env-bucket', 'env-store', 'eu'],
  );
  const flags = parseArgs(
    [
      '--apply',
      'docs',
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
  assert.equal('full' in flags, false);
  assert.equal(flags.prefix, 'handbook/');
  assert.equal(flags.bucket, 'my-bucket');
  assert.equal(flags.project, 'flag-project-1');
  assert.equal(flags.dataStore, 'store_2');
});

test('bad arguments and unsafe names are rejected before anything runs', () => {
  const bad = (argv, env = {}) => assert.throws(() => parseArgs(argv, env), UsageError);
  const p = ['--prefix', 'handbook/'];
  bad([...p]);
  bad(['a', 'b', ...p]);
  bad(['a', '--nope', ...p]);
  bad(['a', '--prefix']);
  bad(['a', '--bucket', 'Bad Bucket', ...p]);
  bad(['a', '--bucket', 'x; rm -rf /', ...p]);
  bad(['a', '--data-store', '../store', ...p]);
  bad(['a', '--data-store', 'UPPER', ...p]);
  bad(['a', '--project', 'p;ls', ...p]);
  bad(['a', '--prefix', '../escape']);
  bad(['a', '--prefix', 'a/*']);
  bad(['a', '--prefix', 'a b/']);
  bad(['a', ...p], { VERTEX_SEARCH_LOCATION: 'eu/x' });
  assert.equal(parseArgs(['--help'], {}).help, true);
  assert.equal(normalizePrefix('/handbook/2026'), 'handbook/2026/');
});

test('D-2: the bucket root, any <document id>/ folder and --full are refused with a usage error', () => {
  const refused = (argv, pattern) =>
    assert.throws(
      () => parseArgs(argv, {}),
      (error) => {
        assert.ok(error instanceof UsageError);
        assert.match(error.message, pattern);
        return true;
      },
    );
  // No --prefix, an empty one, or only slashes: the bucket root.
  refused(['docs'], /--prefix is required/);
  refused(['docs', '--prefix', ''], /--prefix is required/);
  refused(['docs', '--prefix=/'], /--prefix is required/);
  refused(['docs', '--prefix', '  '], /--prefix is required/);
  // The HR namespace: a document ID folder, alone or as the first folder, any case.
  const id = '056e3b6c-02a1-454c-a174-00f04d41e4ec';
  for (const prefix of [id, `${id}/`, `/${id}/sub/`, id.toUpperCase()])
    refused(['docs', '--prefix', prefix], /document id/);
  // FULL reconciliation, with or without other flags.
  refused(['docs', '--full'], /--full is not supported/);
  refused(['docs', '--prefix', 'handbook/', '--full', '--apply'], /--full is not supported/);
  // A UUID-like name further down, or a near miss, is an ordinary folder.
  assert.equal(normalizePrefix(`handbook/${id}`), `handbook/${id}/`);
  assert.equal(
    normalizePrefix('056e3b6c-02a1-454c-a174-00f04d41e4e'),
    '056e3b6c-02a1-454c-a174-00f04d41e4e/',
  );
  assert.throws(() => importBody({ bucket: 'b', prefix: '' }), UsageError);
});

test('D-2: main exits 2 with the usage text and runs nothing for a refused prefix or --full', async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'import-docs-'));
  const errors = [];
  const original = { error: console.error, log: console.log, fetch: globalThis.fetch };
  try {
    writeFileSync(path.join(folder, 'one.pdf'), 'x');
    console.error = (line) => errors.push(String(line));
    console.log = () => assert.fail('nothing is planned for a refused run');
    globalThis.fetch = () => assert.fail('a refused run must not use the network');
    for (const argv of [
      [folder],
      [folder, '--apply'],
      [folder, '--prefix', '11111111-2222-3333-4444-555555555555/'],
      [folder, '--prefix', 'handbook/', '--full'],
    ])
      assert.equal(await main(argv, {}), 2, argv.join(' '));
  } finally {
    Object.assign(console, { error: original.error, log: original.log });
    globalThis.fetch = original.fetch;
    rmSync(folder, { recursive: true, force: true });
  }
  assert.equal(errors.length, 4);
  assert.ok(errors.every((text) => text.includes('Usage: npm run docs:import')));
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
  assert.equal(
    operationUrl('projects/p/operations/import-1'),
    'https://discoveryengine.googleapis.com/v1/projects/p/operations/import-1',
  );
  // VERTEX_SEARCH_LOCATION picks the regional endpoint (it was always global).
  const eu = parseArgs(['docs', '--prefix', 'handbook/'], { VERTEX_SEARCH_LOCATION: 'eu' });
  assert.equal(
    importUrl(eu),
    `https://eu-discoveryengine.googleapis.com/v1/projects/${DEFAULTS.project}/locations/eu/collections/default_collection/dataStores/onboardai-docs/branches/default_branch/documents:import`,
  );
  assert.equal(
    operationUrl('projects/p/operations/import-1', 'eu'),
    'https://eu-discoveryengine.googleapis.com/v1/projects/p/operations/import-1',
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

test('the plan lists files and commands, is always INCREMENTAL, and warns in apply mode', () => {
  const classified = classifyFiles(['a.pdf', 'b.md']);
  const dry = buildPlan(parseArgs(['docs', '--prefix', 'handbook/'], {}), classified);
  assert.match(dry, /DRY RUN/);
  assert.match(dry, /a\.pdf/);
  assert.match(dry, /gcloud storage rsync docs gs:\/\/[^ ]+\/handbook\//);
  assert.match(dry, /INCREMENTAL/);
  assert.match(dry, /documents:import/);
  assert.match(dry, /\(global, default_collection, default_branch\)/);
  assert.ok(!dry.includes('FULL'));
  assert.ok(!dry.includes(publicExposureWarning));
  const applied = buildPlan(
    parseArgs(['docs', '--apply', '--prefix', 'handbook/'], {}),
    classified,
  );
  assert.ok(!applied.includes('DRY RUN'));
  assert.ok(!applied.includes('FULL'));
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
    assert.equal(await main([folder, '--prefix', 'handbook/'], {}), 0);
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
