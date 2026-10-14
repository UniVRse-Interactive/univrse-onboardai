import test from 'node:test';
import assert from 'node:assert/strict';
import { visualAnswer, simpleAnswer } from '../src/avatar/visual-answer-content.mjs';

const sourced = (text) => ({
  text,
  mode: 'gemini-chat',
  passages: [{ title: 'Synthetic handbook' }],
});
test('visual steps preserve the complete wording and conditions, including decimal values', () => {
  const answer =
    '1. Ask your manager before submitting receipts.\n2. Claim mileage at 0.50 per kilometre only if approved.\n3. Keep your original receipts.';
  const guide = visualAnswer(sourced(answer));
  assert.equal(guide.kind, 'steps');
  assert.equal(guide.text, answer);
  assert.deepEqual(
    guide.items.map((p) => p.body),
    [
      'Ask your manager before submitting receipts.',
      'Claim mileage at 0.50 per kilometre only if approved.',
      'Keep your original receipts.',
    ],
  );
  const inline = visualAnswer(sourced('1. Open the tool. 2. Send the update.'));
  assert.deepEqual(
    inline.items.map((p) => p.body),
    ['Open the tool.', 'Send the update.'],
  );
});
test('facts and nonsequential numbers do not become task flows or invented timelines', () => {
  for (const answer of [
    'Office hours start at 10.30 AM. Confirm exceptions with your manager.',
    '1. Read this option.\n3. This is a separate reference.',
  ]) {
    const guide = visualAnswer(sourced(answer));
    assert.equal(guide.kind, 'points');
    assert.equal(
      guide.items
        .map((p) => p.body)
        .join(' ')
        .replace(/\s+/g, ' '),
      answer.replace(/\s+/g, ' '),
    );
  }
  const answer = Array.from({ length: 9 }, (_, i) => `Condition ${i + 1} applies.`).join(' ');
  const guide = visualAnswer(sourced(answer));
  assert.equal(guide.items.length, 1);
  assert.equal(guide.items[0].body, answer);
  const facts = visualAnswer(
    sourced('1. The company makes mobile apps.\n2. Its team develops virtual experiences.'),
  );
  assert.equal(facts.kind, 'points');
  assert.deepEqual(
    facts.items.map((p) => p.body),
    ['The company makes mobile apps.', 'Its team develops virtual experiences.'],
  );
});
test('unconfirmed replies stay whole and labelled as conversation, and empty answers are rejected', () => {
  const text = '1. I cannot confirm this policy.\n2. Please check with HR.';
  for (const message of [{ text }, { ...sourced(text), mode: 'demo' }]) {
    const guide = visualAnswer(message);
    assert.equal(guide.grounded, false);
    assert.equal(guide.kind, 'reply');
    assert.equal(guide.items[0].body, text);
  }
  assert.equal(visualAnswer({ text: '' }), null);
  const guide = visualAnswer({
    ...sourced('This is an illustration. Confirm the actual policy with HR.'),
    learning: { format: 'example' },
  });
  assert.equal(guide.kind, 'example');
  assert.equal(guide.example, true);
});

test('plain wording preserves policy qualifications and leaves unfamiliar instructions intact', () => {
  assert.equal(
    simpleAnswer(
      'Ensure you communicate in English, as all participants are required to use English throughout the meeting.',
    ),
    'Use English throughout the meeting.',
  );
  const conditional =
    'Ensure you communicate in English, as all participants are required to use English throughout the meeting unless your manager approves an exception.';
  assert.equal(simpleAnswer(conditional), conditional);
  const answer = 'Prepare your receipts to share during the review only after approval.';
  assert.equal(simpleAnswer(answer), answer);
  const unknown = 'Wear a plain T-shirt on Fridays only, unless you have a client meeting.';
  assert.equal(simpleAnswer(unknown), unknown);
  const guide = visualAnswer(sourced(conditional));
  assert.equal(guide.items[0].body, conditional);
  assert.equal(guide.text, conditional);
});

test('artwork labels and time highlights use explicit answer subjects and actual times', () => {
  const guide = visualAnswer(
    sourced('Office hours start at 10.30 AM and end at 6.30 PM. Confirm exceptions with HR.'),
  );
  assert.equal(guide.items[0].scene, 'time');
  assert.deepEqual(guide.items[0].times, ['10.30 AM', '6.30 PM']);
  assert.equal(guide.items[1].scene, 'people');
  const report = visualAnswer(
    sourced(
      'Prepare your work updates and progress reports to share during the weekly progress update session.',
    ),
  );
  assert.equal(report.items[0].scene, 'document');
  assert.equal(report.items[0].title, 'Prepare your update');
  const unconfirmed = visualAnswer({ text: 'Office hours start at 10.30 AM.' });
  assert.equal(unconfirmed.kind, 'reply');
  assert.equal(unconfirmed.grounded, false);
  const clothes = visualAnswer(
    sourced('Ripped jeans, short pants, and slippers are not allowed in the office on weekdays.'),
  );
  assert.deepEqual(clothes.items[0].clothes, ['jeans', 'shorts', 'slippers']);
  assert.equal(clothes.items[0].ripped, true);
  assert.equal(clothes.items[0].plain, clothes.items[0].body);
});
