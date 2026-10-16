import test from 'node:test';
import assert from 'node:assert/strict';
import { answerPresentation, presentationSceneAt } from '../../src/avatar/answer-presentation.mjs';
import { spokenText } from '../../src/avatar/speech-text-and-mouth-timing.js';

function present(text, question = 'Tell me about onboarding') {
  return answerPresentation({ text, reply: text, referenceQuestion: question });
}

test('every answer uses its spoken sentence boundaries, with no need for sources or manual pages', () => {
  const text =
    '**Bring** your ID 🪪 and laptop. Meet your manager. Read https://example.com/handbook before orientation.';
  const sequence = present(text, 'What should I do on my first day?');
  assert.equal(sequence.kind, 'onboarding');
  assert.equal(sequence.text, spokenText(text));
  assert.equal(sequence.scenes.map((scene) => scene.body).join(' '), sequence.text);
  assert.equal(sequence.scenes.length, 3);
  for (const [index, scene] of sequence.scenes.entries()) {
    assert.equal(presentationSceneAt(sequence, scene.start), index);
    assert.equal(presentationSceneAt(sequence, scene.end - 1), index);
    assert.equal(sequence.text.slice(scene.start, scene.end).trim(), scene.body);
  }
  for (const value of [null, undefined, NaN, -1, sequence.text.length])
    assert.equal(presentationSceneAt(sequence, value), -1);
});

test('working hours preserve exact 12-hour and 24-hour clock values without invented ranges', () => {
  const sequence = present(
    'Normal hours are 9:00 a.m. to 5:30 p.m., Monday to Friday. Lunch is at 12:30. Hours may vary with manager approval.',
    'What are the working hours?',
  );
  assert.equal(sequence.scenes.length, 3);
  assert.deepEqual(
    sequence.scenes[0].visuals.map((item) => item.label),
    ['9:00 a.m.', '5:30 p.m.'],
  );
  assert.equal(sequence.scenes[1].visuals[0].label, '12:30');
  assert.equal(sequence.scenes[2].condition, true);
  const independent = present('Briefings are at 9am, 11am and 3pm.');
  assert.ok(independent.scenes[0].visuals.every((item) => !item.label.includes('–')));
  assert.equal(present('You may leave the office at 5pm.').scenes[0].visuals[0].kind, 'time');
});

test('leave guidance changes from application to approval to HR without inventing eligibility', () => {
  const text =
    'Submit your annual leave request through the employee portal. Wait for manager approval before booking travel. Ask HR about your eligibility.';
  const sequence = present(text, 'How do I apply for leave?');
  assert.deepEqual(
    sequence.scenes.map((scene) => scene.visuals[0].kind),
    ['leave', 'approval', 'people'],
  );
  assert.equal(sequence.scenes[1].condition, true);
  assert.equal(sequence.scenes.map((scene) => scene.body).join(' '), text);
  assert.ok(
    sequence.scenes.every(
      (scene) => !scene.visuals.some((visual) => 'days' in visual || 'approved' in visual),
    ),
  );
});

test('first-day tasks change subject with the answer rather than inheriting the question topic', () => {
  const sequence = present(
    'Check in at reception when you arrive. Bring your identification documents and laptop. Meet your manager and review your checklist.',
    'What should I do on my first day?',
  );
  assert.deepEqual(
    sequence.scenes.map((scene) => scene.visuals.map((visual) => visual.kind)),
    [['arrival'], ['computer', 'document'], ['people', 'tasks']],
  );
});

test('safety, pay, meetings, IT, company information and unfamiliar topics all get relevant scenes', () => {
  for (const [text, kind] of [
    ['Review the emergency evacuation route.', 'security'],
    ['Keep your payslip for payroll questions.', 'payroll'],
    ['Attend the orientation meeting.', 'meeting'],
    ['Sign in to your email account.', 'computer'],
    ['Our company values curiosity.', 'company'],
    ['This is an unfamiliar onboarding subject.', 'tasks'],
    ['The process differs by location.', 'document'],
  ])
    assert.equal(present(text).scenes[0].visuals[0].kind, kind, text);
  assert.notEqual(present('Read it before you start.').scenes[0].visuals[0].kind, 'computer');
});

test('unknown policy answers stay neutral and clothing keeps its dedicated artwork', () => {
  const unknown = present(
    'I cannot confirm your annual leave entitlement. Check with HR for your policy.',
    'How much leave do I get?',
  );
  assert.equal(unknown.scenes[0].label, 'Check company guidance');
  assert.ok(
    unknown.scenes
      .flatMap((scene) => scene.visuals)
      .every((visual) => ['document', 'people'].includes(visual.kind)),
  );
  const clothing = present('Wear a blouse with trousers. Avoid beachwear.', 'What should I wear?');
  assert.equal(clothing.kind, 'clothing');
  assert.deepEqual(clothing.scenes[0].garments, ['blouse', 'trousers']);
  assert.equal(clothing.scenes[1].avoid, true);
  assert.equal(answerPresentation({ text: '', reply: '' }), null);
});

test('a time in a sentence about something else does not take over its scene (QA F-2)', () => {
  // The answer QA saw for "How do I set up my laptop and email accounts with IT?".
  const it = present(
    'Your laptop, accounts, and 2-step verification are set up at 09:45 on your first day in the IT corner on Level 12 with IT Support.',
    'How do I set up my laptop and email accounts with IT?',
  );
  assert.equal(it.scenes[0].label, 'Tools & access');
  assert.deepEqual(
    it.scenes[0].visuals.map((visual) => [visual.kind, visual.label]),
    [
      ['computer', 'Tools & access'],
      ['time', '09:45'],
    ],
    'the clock stays, beside the subject, with the literal time',
  );
  // Sentences about time keep the clock first.
  assert.equal(
    present('Office hours are 9:00 a.m. to 6:00 p.m.').scenes[0].visuals[0].kind,
    'time',
  );
  assert.equal(present('Your day starts at 9:00 a.m.').scenes[0].visuals[0].kind, 'time');
});

test('each onboarding topic leads with its own scene, with or without a time', () => {
  for (const [question, sentence, kind] of [
    [
      'What are the working hours?',
      'Office hours are 9:00 a.m. to 6:00 p.m., Monday to Friday.',
      'time',
    ],
    [
      'How do I apply for leave?',
      'Apply for annual leave in the HR portal at least three days ahead, by 5 p.m.',
      'leave',
    ],
    [
      'What happens on my first day?',
      'On your first day, arrive at reception on Level 12 by 08:45.',
      'arrival',
    ],
    ['How do I set up IT?', 'Sign in to your email account at 10:00 with IT Support.', 'computer'],
    [
      'What is the fire safety procedure?',
      'Fire drills are held every quarter at 3 p.m., so follow the evacuation route.',
      'security',
    ],
    ['When is pay day?', 'Salaries are paid on the 25th of each month before 5 p.m.', 'payroll'],
    [
      'How do I prepare for meetings?',
      'The weekly team meeting is every Monday at 10:00.',
      'meeting',
    ],
  ])
    assert.equal(present(sentence, question).scenes[0].visuals[0].kind, kind, question);
  // Dress code answers use the clothing artwork.
  const clothing = present(
    'Smart casual is the dress code from 9am on weekdays.',
    'What should I wear?',
  );
  assert.equal(clothing.kind, 'clothing');
  assert.deepEqual(clothing.scenes[0].garments, ['outfit']);
});

test('a meal mentioned in passing does not open a schedule scene with an empty clock', () => {
  // The real "Meet your buddy" briefing, second sentence.
  const buddy = present(
    'Your buddy stays with you from lunch on day 1, gives you the office tour and helps you with your first small task.',
    'Meet your buddy',
  );
  assert.equal(buddy.scenes[0].visuals[0].kind, 'people');
  assert.ok(buddy.scenes[0].visuals.every((visual) => visual.kind !== 'time'));
  // Sentences about the schedule itself keep the clock.
  assert.equal(present('Lunch is one hour.').scenes[0].visuals[0].kind, 'time');
  assert.equal(
    present('Your manager sets your working hours with the team.').scenes[0].visuals[0].kind,
    'time',
  );
});
