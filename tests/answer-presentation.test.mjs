import test from 'node:test';
import assert from 'node:assert/strict';
import { answerPresentation, presentationSceneAt } from '../src/avatar/answer-presentation.mjs';
import { spokenText } from '../src/avatar/speech-text-and-mouth-timing.js';

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
