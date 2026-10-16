import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrain } from '../server/brain.mjs';
const doc = { pageContent: 'Ask HR to confirm office attire.', metadata: { title: 'Test guidance' } };
function setup({ passages = [doc], output = { answer: 'Ask HR to confirm.', citations: [1] } } = {}) {
  const calls = [];
  return { calls, brain: createBrain({ env: {}, retrieve: async () => passages, models: {
    plan: { invoke: async (messages) => { calls.push(messages); return { kind: 'company', query: 'office attire', clarification: '' }; } },
    answer: { invoke: async () => output },
  } }) };
}
test('returns a sourced answer and never includes history or reports', async () => {
  const { brain } = setup();
  const result = await brain.ask('What can I wear?');
  assert.equal(result.answer, 'Ask HR to confirm.');
  assert.equal(result.passages[0].title, 'Test guidance');
  assert.deepEqual(Object.keys(result).sort(), ['answer', 'clothingTopic', 'passages', 'source']);
});
test('each request starts independently, including concurrent callers', async () => {
  const { brain, calls } = setup();
  await Promise.all([brain.ask('What about jeans?'), brain.ask('What about shoes?')]);
  assert.equal(calls.length, 2);
  for (const messages of calls) assert.equal(messages.length, 2);
  assert.notEqual(calls[0][1].content, calls[1][1].content);
});
test('missing documents and unsupported citations cannot establish policy', async () => {
  assert.match((await setup({ passages: [] }).brain.ask('What can I wear?')).answer, /couldn’t find/);
  assert.match((await setup({ output: { answer: 'Anything is fine.', citations: [] } }).brain.ask('What can I wear?')).answer, /does not clearly establish/);
  await assert.rejects(setup({ output: { answer: 'Anything.', citations: [99] } }).brain.ask('What can I wear?'), /verified answer/);
});
test('input, configuration and cancellation fail explicitly', async () => {
  const { brain } = setup();
  await assert.rejects(brain.ask(''), /question/);
  await assert.rejects(createBrain({ env: {}, loadDocuments: async () => [] }).ask('Hello'), /GEMINI_API_KEY/);
  await assert.rejects(brain.ask('Hello', { signal: AbortSignal.abort() }), { name: 'AbortError' });
});
test('provider failures do not expose raw error contents', async () => {
  const brain = createBrain({ env: {}, models: { plan: { invoke: async () => { throw new Error('private-provider-payload'); } } } });
  await assert.rejects(brain.ask('Hello'), (e) => !e.message.includes('private-provider-payload'));
});
test('original passage retrieval works with caller-provided company guidance', async () => {
  const brain = createBrain({ env: {}, loadDocuments: async () => [
    { title: 'Test handbook', text: 'Office attire\nAsk HR to confirm office attire before your first day.' },
  ], models: {
    plan: { invoke: async () => ({ kind: 'company', query: 'office attire', clarification: '' }) },
    answer: { invoke: async () => ({ answer: 'Ask HR to confirm office attire.', citations: [1] }) },
  } });
  const result = await brain.ask('What is the office attire?');
  assert.equal(result.passages[0].title, 'Test handbook');
  assert.equal(result.source, 'Test handbook');
});
