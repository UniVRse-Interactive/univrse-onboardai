import test from 'node:test';
import assert from 'node:assert/strict';
import { paginateVisualText, visualPageAt } from '../src/avatar/visual-text-pagination.mjs';

const normalise = (text) => text.replace(/\s+/g, ' ').trim();
test('visual pages fit a small reading space without losing conditions or ordering', () => {
  const text =
    'Submit the form only after your manager approves it. Do not share passwords. If you are unsure which documents apply to your role, check with HR before submitting them. Keep the original receipts unless HR tells you otherwise.';
  for (const capacity of [55, 110, 500]) {
    const pages = paginateVisualText(text, (candidate) => candidate.length <= capacity);
    assert.equal(normalise(pages.map((page) => page.text).join(' ')), normalise(text));
    assert.ok(pages.every((page) => page.text && page.text.length <= capacity));
    assert.ok(pages.every((page) => text.slice(page.start, page.end).trim() === page.text));
  }
});

test('short guidance stays on one page; long unbroken text and Unicode stay readable', () => {
  const short = 'Check with HR.';
  assert.deepEqual(
    paginateVisualText(short, (candidate) => candidate.length <= 100),
    [{ start: 0, end: short.length, text: short }],
  );
  const long = '🔎'.repeat(70) + '🏢'.repeat(50);
  const pages = paginateVisualText(long, (candidate) => candidate.length <= 30);
  assert.ok(pages.length > 1);
  assert.equal(pages.map((page) => page.text).join(''), long);
  assert.ok(pages.every((page) => page.text.length <= 30 && !/\p{Surrogate}/u.test(page.text)));
});

test('page breaks keep clock labels and short restriction phrases together', () => {
  const text =
    'Check the schedule carefully: start at 9:00 a.m. and finish at 5:30 p.m. Unapproved changes are not allowed unless your manager confirms an exception.';
  for (const capacity of [45, 55, 65]) {
    const pages = paginateVisualText(text, (candidate) => candidate.length <= capacity);
    assert.equal(normalise(pages.map((page) => page.text).join(' ')), text);
    for (const phrase of ['9:00 a.m.', '5:30 p.m.', 'not allowed'])
      assert.ok(
        pages.some((page) => page.text.includes(phrase)),
        phrase,
      );
  }
});

test('resizing the guide preserves the reading anchor and previous-part navigation finds the last page', () => {
  const text = 'Please read every instruction carefully. '.repeat(20).trim();
  const narrow = paginateVisualText(text, (candidate) => candidate.length <= 80);
  const wide = paginateVisualText(text, (candidate) => candidate.length <= 180);
  const anchor = narrow[3].start;
  const index = visualPageAt(wide, anchor);
  assert.ok(wide[index].start <= anchor && wide[index].end > anchor);
  assert.equal(visualPageAt(wide, Number.MAX_SAFE_INTEGER), wide.length - 1);
});
