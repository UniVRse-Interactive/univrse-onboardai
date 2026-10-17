import test from 'node:test';
import assert from 'node:assert/strict';
import { clothingPresentation, clothingSceneAt } from '../../src/avatar/clothing-presentation.mjs';
import { spokenText } from '../../src/avatar/speech-text-and-mouth-timing.js';

test('clothing scenes use actual spoken character boundaries and only mentioned garments', () => {
  const reply =
    'Business casual is the dress code. Wear a blouse with trousers or a skirt. Avoid sleepwear and beachwear.';
  const presentation = clothingPresentation({ referenceQuestion: 'What should I wear?' }, reply);
  assert.equal(presentation.text, spokenText(reply));
  assert.deepEqual(
    presentation.scenes.map((scene) => scene.garments),
    [['outfit'], ['blouse', 'trousers', 'skirt'], ['sleepwear', 'beachwear']],
  );
  assert.equal(presentation.scenes[2].label, 'Avoid for office');
  assert.equal(clothingSceneAt(presentation, reply.indexOf('Wear')), 1);
  assert.equal(clothingSceneAt(presentation, reply.indexOf('Avoid')), 2);
  for (const progress of [null, undefined, NaN, -1, reply.length + 1])
    assert.equal(clothingSceneAt(presentation, progress), -1);
});

test('restrictions preserve qualifiers and do not label every pictured garment approved', () => {
  const reply =
    'Ripped jeans, short pants, T-shirts and slippers are not allowed on weekdays. Plain T-shirts are permitted on Fridays only.';
  const presentation = clothingPresentation(
    { referenceQuestion: 'Can I wear jeans to work?' },
    reply,
  );
  assert.equal(presentation.scenes[0].avoid, true);
  assert.equal(presentation.scenes[0].ripped, true);
  assert.equal(presentation.scenes[0].label, 'Avoid on weekdays');
  assert.deepEqual(presentation.scenes[0].garments, ['shirt', 'jeans', 'shorts', 'slippers']);
  assert.equal(presentation.scenes[1].label, 'Friday only');
  assert.equal(presentation.scenes[1].avoid, false);
});

test('unrelated questions have no clothing sequence and unrelated speech creates a visual gap', () => {
  assert.equal(
    clothingPresentation(
      { referenceQuestion: 'What are the working hours?' },
      'The dress code is smart casual.',
    ),
    null,
  );
  assert.equal(
    clothingPresentation(
      { referenceQuestion: 'How do I request leave?' },
      'Apply online and contact HR.',
    ),
    null,
  );
  const reply = 'The dress code is smart casual. Contact HR for the exact policy.';
  const presentation = clothingPresentation({ referenceQuestion: 'What should I wear?' }, reply);
  assert.equal(clothingSceneAt(presentation, reply.indexOf('Contact')), -1);
  assert.equal(
    clothingPresentation(
      { referenceQuestion: 'What should I wear?' },
      'I cannot confirm this. Please check with HR.',
    ),
    null,
  );
});

test('contrasting permissions have separate scenes with exact speech offsets', () => {
  const reply =
    'Wear a smart shirt with trousers, but avoid ripped jeans; check your dress code first.';
  const presentation = clothingPresentation(
    { referenceQuestion: 'What can I wear on my first day?' },
    reply,
  );
  assert.equal(presentation.scenes.map((scene) => scene.body).join(' '), spokenText(reply));
  assert.deepEqual(presentation.scenes[0].garments, ['collared', 'trousers']);
  assert.equal(presentation.scenes[0].avoid, false);
  assert.deepEqual(presentation.scenes[1].garments, ['jeans']);
  assert.equal(presentation.scenes[1].avoid, true);
  assert.equal(clothingSceneAt(presentation, reply.indexOf('but')), 1);
  assert.equal(clothingSceneAt(presentation, reply.indexOf('check')), -1);
});

test('office alternatives and condition labels retain all garments and qualifications', () => {
  const presentation = clothingPresentation(
    { referenceQuestion: 'What is business casual?' },
    'Try a blazer, shirt, trousers, skirt and closed-toe shoes. Jeans depend on your company policy.',
  );
  assert.deepEqual(presentation.scenes[0].garments, [
    'collared',
    'blazer',
    'trousers',
    'skirt',
    'shoes',
  ]);
  assert.equal(presentation.scenes[1].conditional, true);
  assert.equal(presentation.scenes[1].avoid, false);
  for (const text of [
    'You cannot wear beachwear.',
    "You can't wear sleepwear.",
    'Jeans are not appropriate.',
  ])
    assert.equal(
      clothingPresentation({ referenceQuestion: 'What clothing should I avoid?' }, text).scenes[0]
        .avoid,
      true,
    );
  assert.equal(
    clothingPresentation({ referenceQuestion: 'Can I wear jeans?' }, 'Jeans are not prohibited.')
      .scenes[0].avoid,
    false,
  );
});

test('a neat pair refers to the jeans being discussed rather than a different outfit', () => {
  const presentation = clothingPresentation(
    { referenceQuestion: 'Can I wear jeans to work?' },
    'Wear jeans only if your company dress code permits them. Choose a dark, neat pair without rips.',
  );
  assert.deepEqual(presentation.scenes[1].garments, ['jeans']);
  assert.equal(presentation.scenes[1].ripped, false);
});
