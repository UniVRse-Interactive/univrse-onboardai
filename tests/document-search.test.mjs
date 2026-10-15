import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { searchDocuments } from '../server/document-search.mjs';
import { createApp } from '../server/api-routes.mjs';

const documents = [
  {
    title: 'Test handbook',
    text: `Part-Time Employees
Part-time employees work fewer than the normal working hours.
Hours of Work
TEST company working hours:
DAY
\tWORKING HOURS
\tMonday
\t9:00 AM – 5:30 PM
The workweek runs Monday through Friday, from 9:00 a.m. to 5:30 p.m., with one hour for lunch. These hours may change with management approval.
Dress Code and Public Image
The current dress code is smart casual. Clean, neat clothing is required. Ask HR for clarification before a formal client meeting.
Workspace
Employees keep their desk clean.
`,
  },
];

test('working-hours queries rank the full schedule above incidental mentions and retain qualifications', () => {
  const result = searchDocuments('what is the hours of work', documents);
  assert.equal(result.mode, 'document-search');
  assert.equal(result.matched, true);
  assert.equal(result.passages[0].heading, 'Hours of Work');
  assert.match(result.answer, /Monday through Friday/);
  assert.match(result.answer, /one hour for lunch/);
  assert.match(result.passages[0].preview, /Monday through Friday/);
  assert.ok(documents[0].text.includes(result.passages[0].preview));
  assert.match(result.answer, /may change with management approval/);
  assert.match(result.answer, /Source: Test handbook/);
  assert.ok(!result.answer.includes('fewer than'));
});

test('clothing aliases retrieve quoted dress guidance without inventing an answer', () => {
  const result = searchDocuments('what to wear', documents);
  assert.equal(result.passages[0].heading, 'Dress Code and Public Image');
  assert.match(result.answer, /smart casual/);
  assert.match(result.passages[0].preview, /smart casual/);
  assert.ok(documents[0].text.includes(result.passages[0].text));
  assert.ok(!result.answer.includes('9:00'));
});

test('unrelated, empty and partly matching questions decline instead of returning a random policy', () => {
  for (const question of [
    '',
    'hello',
    'What is the CEO salary?',
    'What are the working hours on Mars?',
  ]) {
    const result = searchDocuments(question, documents);
    assert.equal(result.matched, false, question);
    assert.deepEqual(result.passages, []);
    assert.match(result.answer, /couldn't find/);
  }
});

test('long passages stay bounded and document text remains reference text', () => {
  const text = 'The parking permit costs a fictional test amount. '.repeat(100);
  const result = searchDocuments('parking permit', [{ title: 'Test parking', text }]);
  assert.equal(result.matched, true);
  assert.ok(result.passages.every((passage) => passage.text.length <= 1800));
  assert.ok(result.passages.every((passage) => text.includes(passage.text)));
});

async function withServer(options, check) {
  const server = createApp({ getAccessToken: async () => 'test-token', ...options }).listen(
    0,
    '127.0.0.1',
  );
  await once(server, 'listening');
  try {
    await check(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
const ask = (url) =>
  fetch(url + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'What are the working hours?', taskId: 'quiz-part-1' }),
  });

test('explicit document-search mode works with a configured Vertex project and never calls Gemini', async () => {
  let googleCalls = 0;
  await withServer(
    {
      env: {
        AI_MODE: 'document-search',
        GOOGLE_CLOUD_PROJECT: 'test-project',
        GOOGLE_DRIVE_FOLDER_ID: 'test-folder',
      },
      loadDriveKnowledge: async (folder) => {
        assert.equal(folder, 'test-folder');
        return documents;
      },
      fetchImpl: async () => {
        googleCalls++;
        throw new Error('Gemini must not be called');
      },
    },
    async (url) => {
      const config = await (await fetch(url + '/api/config')).json();
      assert.equal(config.aiMode, 'document-search');
      const response = await ask(url),
        result = await response.json();
      assert.equal(response.status, 200);
      assert.equal(result.mode, 'document-search');
      assert.equal(result.matched, true);
      assert.match(result.answer, /9:00/);
      assert.ok(!JSON.stringify(result).includes('test-secret'));
      assert.equal(googleCalls, 0);
    },
  );
});

test('Gemini billing errors explain credit depletion without leaking raw provider data or substituting local results', async () => {
  await withServer(
    {
      env: { GOOGLE_CLOUD_PROJECT: 'test-project' },
      getAccessToken: async () => 'test-secret',
      fetchImpl: async () => new Response('private provider details', { status: 402 }),
    },
    async (url) => {
      const response = await ask(url),
        result = await response.json();
      assert.equal(response.status, 402);
      assert.equal(result.code, 'GEMINI_CREDIT_REQUIRED');
      assert.match(result.error, /prepaid credit/);
      assert.equal(result.answer, undefined);
      assert.ok(!JSON.stringify(result).includes('private provider'));
    },
  );
});
