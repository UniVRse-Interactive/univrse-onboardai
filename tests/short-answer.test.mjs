import test from 'node:test';
import assert from 'node:assert/strict';
import { shortAnswer, replySentences } from '../src/avatar/short-answer.mjs';
import { presentationGuide } from '../src/avatar/visual-answer-content.mjs';
import { answerReply, presentAnswer } from '../src/avatar/chat-answer-presentation.mjs';
import { visualAnswer } from '../src/avatar/visual-answer-content.mjs';
import { presentationCues } from '../src/avatar/presentation-cues.mjs';
import { spokenText } from '../src/avatar/speech-text-and-mouth-timing.js';

test('clear replies contain up to three complete source sentences without filler or clipping', () => {
  assert.equal(shortAnswer('Ask HR before sending the form.'), 'Ask HR before sending the form.');
  const answer =
    'The current company dress code is smart casual. ' +
    'These additional conditions still apply to each employee in the office. '.repeat(4);
  assert.equal(
    shortAnswer(answer),
    'The dress code is smart casual. These additional conditions still apply to each employee in the office.',
  );
  assert.equal(
    shortAnswer(
      'The dress code is smart casual. ' +
        'Additional office clothing conditions apply. '.repeat(10),
    ),
    'The dress code is smart casual. Additional office clothing conditions apply.',
  );
  assert.equal(
    shortAnswer('1. Ask HR for approval. 2. Send the form.'),
    'Ask HR for approval. Send the form.',
  );
  assert.equal(
    shortAnswer('Work ends at 5:30 p.m. Lunch is one hour. Later details stay in the full answer.'),
    'Work ends at 5:30 p.m. Lunch is one hour. Later details stay in the full answer.',
  );
  const useful =
    'Read the agenda before the meeting. Prepare your work update. Bring any questions. Use English during the meeting. This last detail is in the full source.';
  assert.equal(replySentences(shortAnswer(useful)).length, 3);
  assert.match(shortAnswer(useful), /Bring any questions/);
  assert.ok(!shortAnswer(answer).includes('…'));
  assert.ok(answer.includes('additional conditions'), 'the stored answer is not changed');
});

test('long conditions are kept complete instead of being cut to fit a word or line count', () => {
  const condition =
    'Submit the requested documents only after your manager has checked and approved every required item, unless HR has explicitly confirmed a different process for your team and provided the correct instructions in writing before your first day at the office.';
  const reply = shortAnswer(
    condition +
      ' This further explanation contains many more words that are available in the complete company policy for employees to read.',
  );
  assert.ok(reply.startsWith(condition), 'the complete conditional instruction remains intact');
  assert.ok(!reply.includes('…'));
});

test('every question topic uses the same visible reply for automatic speech, replay and visuals', () => {
  for (const text of [
    'The current Company dress code is smart casual. Please keep in mind, however, that the Company is a professional business office, where clients and others often visit. Generally, clean, neat clothing is acceptable.',
    'The workweek is generally from Monday through Friday, with normal operating hours from 9:00 a.m. to 5:30 p.m., with one hour for lunch. Only on Friday the lunch rules differ.',
    'Read the meeting agenda before the meeting. Prepare your work update. Bring any questions.',
    'Request leave through HR before booking travel. Wait for approval before making arrangements. Check the full policy for eligibility.',
    'Ask IT to set up your work account. Keep your password private. Contact your manager if access is missing.',
  ]) {
    const result = presentAnswer({
      answer: 'Search results',
      mode: 'document-search',
      passages: [{ title: 'Company guide', text }],
    });
    assert.equal(result.text, text, 'the full company wording is retained');
    assert.equal(result.spoken, answerReply(result), 'audio must read exactly the visible reply');
    const sentences = [
      ...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(result.reply),
    ];
    assert.ok(sentences.length >= 2 && sentences.length <= 3);
    assert.ok(!result.reply.includes('…'));
    const visual = visualAnswer({ ...result, text: answerReply(result) });
    assert.equal(visual.text, result.reply);
    assert.equal(presentationCues(visual).text, spokenText(result.spoken));
    assert.ok(result.spoken.length <= result.text.length);
  }
});

test('generated and unsourced replies retain the fuller explanation and identical speech', () => {
  for (const mode of ['gemini-memory', 'gemini-chat', 'document-search', 'demo']) {
    const result = presentAnswer({
      answer:
        'Please check with HR. The current guidance does not confirm this detail. This third sentence stays available under the full answer.',
      mode,
    });
    assert.equal(
      result.reply,
      'Please check with HR. The current guidance does not confirm this detail. This third sentence stays available under the full answer.',
    );
    assert.equal(result.spoken, result.reply);
    assert.equal(
      answerReply({ ...result, spoken: result.text }),
      result.reply,
      'legacy speech text cannot override the visible reply',
    );
  }
});

test('short replies select a practical explanation and respect explicit source-support requests', () => {
  const text =
    'The current Company dress code is smart casual. Please keep in mind, however, that the Company is a professional business office, where clients and others often visit. Generally, clean, neat clothing is acceptable. Employees should be neatly and properly dressed during office hours, ripped jeans, short pants, t-shirt, and slippers are not allowed in the office on weekdays.';
  const standard = presentAnswer(
    { answer: text, mode: 'document-search', passages: [{ text }] },
    'What should I wear to the office?',
  );
  assert.equal(
    standard.reply,
    'The dress code is smart casual. Clean, neat clothing is usually acceptable. Ripped jeans, short pants, t-shirt, and slippers are not allowed on weekdays.',
  );
  assert.equal(standard.spoken, standard.reply);
  assert.equal(standard.text, text);
  const example = presentAnswer({
    answer:
      'Office hours start at 10 AM. For example, a workday starts at 10 AM. Check with HR before changing the schedule.',
    mode: 'document-search',
    learning: { format: 'example' },
    passages: [
      {
        text: 'Office hours start at 10 AM. For example, a workday starts at 10 AM. Check with HR before changing the schedule.',
      },
    ],
  });
  assert.match(example.reply, /^For example, a workday starts at 10 AM\./);
  const missing = presentAnswer({
    answer: 'Office hours start at 10 AM.',
    mode: 'document-search',
    exampleUnavailable: true,
    learning: { format: 'standard' },
    passages: [{ text: 'Office hours start at 10 AM.' }],
  });
  assert.match(missing.reply, /does not include a worked example/);
  assert.equal(missing.spoken, missing.reply);
});

test('an explicit brief request stays shorter while the default gives useful detail', () => {
  const text =
    'Read the agenda before the meeting. Prepare your work update. Bring any questions. Use English during the meeting.';
  assert.equal(replySentences(shortAnswer(text)).length, 3);
  assert.equal(replySentences(shortAnswer(text, { format: 'brief' })).length, 2);
  assert.equal(replySentences(shortAnswer(text, { format: 'steps' })).length, 3);
});

test('direct permission questions lead with the matching restriction and preserve its conditions', () => {
  const text =
    'The dress code is smart casual. Clean, neat clothing is acceptable. Ripped jeans and slippers are not allowed on weekdays. Plain T-shirts are permitted on Fridays only.';
  const result = presentAnswer(
    { answer: text, mode: 'document-search', passages: [{ text }] },
    'Can I wear jeans?',
  );
  assert.match(result.reply, /^Ripped jeans and slippers are not allowed on weekdays\./);
  assert.equal(replySentences(result.reply).length, 3);
  assert.equal(result.spoken, result.reply);
  const shirt = presentAnswer(
    { answer: text, mode: 'document-search', passages: [{ text }] },
    'Can I wear a tshirt?',
  );
  assert.match(shirt.reply, /^Plain T-shirts are permitted on Fridays only\./);
});

test('three-sentence schedule explanations retain both Friday break groups and the regular lunch', () => {
  const text =
    'The workweek is generally from Monday through Friday, with normal operating hours from 9:00 a.m. to 5:30 p.m., with one hour for lunch. Only on Friday the Muslim male employees are allowed a two-hour lunch break from 12:30 p.m. to 2:30 p.m., whereas male non-muslim, and female employees are allocated a one-hour lunch break. The above working hours may be varied at Management’s absolute discretion.';
  const result = presentAnswer(
    { answer: text, mode: 'document-search', passages: [{ text }] },
    'What are the working hours?',
  );
  assert.equal(replySentences(result.reply).length, 3);
  assert.match(result.reply, /lunch is one hour/);
  assert.match(result.reply, /Muslim male employees have a two-hour/);
  assert.match(result.reply, /non-Muslim male employees and female employees have a one-hour/);
  assert.equal(result.spoken, result.reply);
});

test('presentation uses narrow plain wording and retains conditional policy text', () => {
  const text =
    'The workweek is generally from Monday through Friday, with normal operating hours from 9:00 a.m. to 5:30 p.m., with one hour for lunch. Only on Friday the lunch rules differ. The above working hours may be varied at Management’s absolute discretion.';
  const message = { text, mode: 'document-search', passages: [{ text }] };
  const guide = presentationGuide(message);
  assert.equal(
    guide.items[0].body,
    'Work is usually Monday–Friday, 9:00 a.m. to 5:30 p.m.; lunch is one hour.',
  );
  assert.equal(guide.items[1].body, 'Only on Friday the lunch rules differ.');
  assert.equal(guide.items[2].body, 'Management may change these working hours.');
  assert.equal(message.text, text);
  const friday =
    'Only on Friday the Muslim male employees are allowed a two-hour lunch break from 12:30 p.m. to 2:30 p.m., whereas male non-muslim, and female employees are allocated a one-hour lunch break.';
  const plainFriday = presentationGuide({
    text: friday,
    mode: 'document-search',
    passages: [{}],
  }).text;
  assert.equal(
    plainFriday,
    'On Friday only, Muslim male employees have a two-hour lunch break: 12:30 p.m. to 2:30 p.m.; non-Muslim male employees and female employees have a one-hour lunch break.',
  );
  const unknown = 'Wear a plain T-shirt on Fridays only, unless you have a client meeting.';
  assert.equal(
    presentationGuide({ text: unknown, mode: 'document-search', passages: [{}] }).text,
    unknown,
  );
  const clothing =
    'Employees should be neatly and properly dresses during office hours, ripped jeans, short pants, t-shirt, and slippers are not allowed in the office on weekdays.';
  assert.equal(
    presentationGuide({ text: clothing, mode: 'document-search', passages: [{}] }).text,
    'Dress neatly during office hours. Ripped jeans, short pants, t-shirt, and slippers are not allowed on weekdays.',
  );
  const female =
    'For female employees, culottes (women’s knee-length trousers, cut with very full legs to resemble a skirt), short, ‘hot pants’ or revealing dress are also not to be worn in the office.';
  assert.equal(
    presentationGuide({ text: female, mode: 'document-search', passages: [{}] }).text,
    'Female employees must also avoid culottes (wide-legged, knee-length trousers), shorts, hot pants and revealing dresses in the office.',
  );
});
