import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspaceKnowledge,
  interleavePassages,
} from '../../server/workspace-company-knowledge.mjs';
import { CompanySearchError } from '../../server/vertex-ai-search.mjs';

const searchEnv = { GOOGLE_CLOUD_PROJECT: 'test-project', VERTEX_SEARCH_ENGINE_ID: 'test-engine' };
// Synthetic per-workspace uploads.
const uploads = {
  a: [{ title: 'a-hours.txt', text: 'Working Hours\nWorkspace A starts at 8 AM.' }],
  b: [{ title: 'b-hours.txt', text: 'Working Hours\nWorkspace B starts at 7 AM.' }],
  empty: [],
};
const company = (excerpt) => ({
  title: 'Company handbook.pdf',
  heading: 'Working hours · Page 2',
  text: 'Before.\n\n' + excerpt + '\n\nAfter.',
  excerpt,
});

test('passages from two ranked sources alternate, keep their own order and stop at the limit', () => {
  assert.deepEqual(interleavePassages([1, 2, 3], ['a', 'b'], 6), [1, 'a', 2, 'b', 3]);
  assert.deepEqual(interleavePassages([1, 2, 3], ['a', 'b'], 2), [1, 'a']);
  assert.deepEqual(interleavePassages([], ['a', 'b', 'c'], 2), ['a', 'b']);
  assert.deepEqual(interleavePassages([1], [], 6), [1]);
  assert.deepEqual(interleavePassages([], [], 6), []);
});

test('without a search engine only the workspace uploads are searched, never the sample guide', async () => {
  let calls = 0;
  const knowledge = createWorkspaceKnowledge({
    env: { GOOGLE_CLOUD_PROJECT: 'test-project' },
    companyRetrieve: async () => {
      calls++;
      return [company('sample')];
    },
    uploaded: (owner) => uploads[owner],
  });
  assert.equal(knowledge.companySearch, false);
  assert.equal(knowledge.hasKnowledge('empty'), false);
  assert.equal(knowledge.hasKnowledge('a'), true);
  assert.deepEqual(knowledge.status(), { state: 'not-configured', documents: [] });
  const found = await knowledge.retrieve('a', 'working hours');
  assert.deepEqual(
    found.map((p) => p.title),
    ['a-hours.txt'],
  );
  assert.deepEqual(await knowledge.quote('empty', 'What are the working hours?'), []);
  assert.equal(calls, 0);
});

test('with a search engine, company passages lead and each workspace adds only its own uploads', async () => {
  const seen = [];
  const knowledge = createWorkspaceKnowledge({
    env: searchEnv,
    companyRetrieve: async (query, options) => {
      seen.push({ query, signal: options.signal });
      return [company('Office hours start at 9 AM.'), company('Core hours are 10 AM to 4 PM.')];
    },
    uploaded: (owner) => uploads[owner],
  });
  assert.equal(knowledge.hasKnowledge('empty'), true);
  assert.deepEqual(knowledge.status(), { state: 'configured', documents: [] });
  const signal = new AbortController().signal;
  const forA = await knowledge.retrieve('a', 'working hours', { signal });
  assert.deepEqual(
    forA.map((p) => p.title),
    ['Company handbook.pdf', 'a-hours.txt', 'Company handbook.pdf'],
  );
  assert.equal(seen[0].query, 'working hours');
  assert.equal(seen[0].signal, signal);
  assert.ok(!JSON.stringify(await knowledge.retrieve('b', 'working hours')).includes('8 AM'));
  const quoted = await knowledge.quote('a', 'What are the working hours?');
  assert.deepEqual(
    quoted.map((p) => [p.title, p.preview]),
    [
      ['Company handbook.pdf', 'Office hours start at 9 AM.'],
      ['a-hours.txt', 'Workspace A starts at 8 AM.'],
    ],
  );
});

test('uploads added or removed are searched on the next question', async () => {
  const documents = [{ title: 'old.txt', text: 'Working Hours\nThe old guide starts at 8 AM.' }];
  const knowledge = createWorkspaceKnowledge({ env: {}, uploaded: () => documents });
  assert.equal((await knowledge.retrieve('a', 'working hours'))[0].title, 'old.txt');
  documents.splice(0, 1, {
    title: 'new.txt',
    text: 'Working Hours\nThe new guide starts at 11 AM.',
  });
  assert.deepEqual(
    (await knowledge.retrieve('a', 'working hours')).map((p) => p.title),
    ['new.txt'],
  );
  documents.length = 0;
  assert.deepEqual(await knowledge.retrieve('a', 'working hours'), []);
});

test('company search failures keep their code, and an incomplete setting is reported without a search', async () => {
  const knowledge = createWorkspaceKnowledge({
    env: searchEnv,
    companyRetrieve: async () => {
      throw new CompanySearchError('SEARCH_ACCESS_DENIED');
    },
    uploaded: (owner) => uploads[owner],
  });
  await assert.rejects(knowledge.retrieve('a', 'working hours'), {
    code: 'SEARCH_ACCESS_DENIED',
  });
  await assert.rejects(knowledge.quote('a', 'working hours'), { code: 'SEARCH_ACCESS_DENIED' });
  const incomplete = createWorkspaceKnowledge({
    env: { VERTEX_SEARCH_ENGINE_ID: 'test-engine' },
    companyRetrieve: async () => assert.fail('status must not search'),
    uploaded: () => [],
  });
  const status = incomplete.status();
  assert.equal(status.state, 'unavailable');
  assert.equal(status.code, 'SEARCH_NOT_CONFIGURED');
  assert.match(status.error, /GOOGLE_CLOUD_PROJECT/);
  assert.deepEqual(status.documents, []);
});
