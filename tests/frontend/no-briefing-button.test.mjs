import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// #66: each step has one entry point, Ask Alya. The separate "Get Alya's
// briefing" button is gone from every screen.
async function sourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : [join(dir, entry.name)],
    ),
  );
  return nested.flat().filter((file) => /\.(jsx?|mjs|css|html)$/.test(file));
}

test('no "Get Alya’s briefing" wording anywhere in src', async () => {
  const files = await sourceFiles('src');
  assert.ok(files.length > 50, 'the scan reads the source tree');
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /Get Alya[’']s briefing/i, file);
  }
});
