import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceQuestion } from '../server/source-answer-support.mjs';

test('source follow-ups resolve the original subject without trapping new questions in an old topic', () => {
  const messages = [
    { role: 'user', text: 'What are the working hours?' },
    { role: 'assistant', result: { searchQuery: 'What are the working hours?' } },
  ];
  assert.equal(
    sourceQuestion('Please keep the answer brief for this question: What should I wear?', messages),
    'What should I wear?',
  );
  assert.equal(
    sourceQuestion('Give me a worked example.', messages),
    'What are the working hours?',
  );
  assert.equal(
    sourceQuestion(
      'Please explain this step by step for this question: What should I wear?',
      messages,
    ),
    'What should I wear?',
  );
  assert.equal(
    sourceQuestion('Give me an example about the dress code.', messages),
    'Give me an example about the dress code.',
  );
  assert.equal(sourceQuestion('What is the leave policy?', messages), 'What is the leave policy?');
  assert.equal(
    sourceQuestion('What about Friday?', messages),
    'What are the working hours? Friday',
  );
  assert.equal(sourceQuestion('What does that mean?', messages), 'What are the working hours?');
  assert.equal(
    sourceQuestion('What about the leave policy?', messages),
    'What about the leave policy?',
  );
  assert.equal(sourceQuestion('What about Friday?', []), 'What about Friday?');
});
