import test from 'node:test';
import assert from 'node:assert/strict';
import { presentationCues, presentationPosition } from '../src/avatar/presentation-cues.mjs';
import { visualAnswer } from '../src/avatar/visual-answer-content.mjs';
import { spokenText } from '../src/avatar/speech-text-and-mouth-timing.js';

function guide(text) {
  return visualAnswer({ text, mode: 'gemini-chat', passages: [{ text }] });
}

test('voice cues match spoken cleanup while retaining exact original source positions', () => {
  const answer = guide(
    '1. **Read** the handbook at https://example.com/guide.\n2. Ask HR before approval.\n3. Bring your ID 🪪 and laptop.',
  );
  const cues = presentationCues(answer);
  assert.equal(cues.text, spokenText(answer.text));
  assert.equal(answer.items.length, 3);
  for (const [part, word] of ['Read', 'Ask', 'Bring'].entries()) {
    assert.deepEqual(presentationPosition(cues, cues.text.indexOf(word)), {
      part,
      character: part === 0 ? 2 : 0,
    });
  }
  const location = presentationPosition(cues, cues.text.indexOf('laptop'));
  assert.equal(
    answer.items[location.part].body.slice(location.character, location.character + 6),
    'laptop',
  );
  assert.equal(answer.items[1].body, 'Ask HR before approval.');
});

test('bullets, whitespace and repeated passages keep their order without dropping conditions', () => {
  const text =
    '  # Your guide\n- Check with HR.\n- Check with HR.\n\nOnly attend after approval.  ';
  const answer = guide(text);
  const cues = presentationCues(answer);
  assert.equal(cues.text, spokenText(answer.text));
  const final = presentationPosition(cues, cues.text.indexOf('Only'));
  assert.equal(final.part, 1);
  assert.equal(answer.items[final.part].body.slice(final.character), 'Only attend after approval.');
  assert.equal(presentationPosition(cues, -5).part, 0);
  assert.equal(presentationPosition(cues, Number.MAX_SAFE_INTEGER).part, 1);
});
