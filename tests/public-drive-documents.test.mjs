import test from 'node:test';
import assert from 'node:assert/strict';
import { readPublicDriveKnowledge } from '../server/public-drive-documents.mjs';
import { driveFailure } from '../server/google-drive-documents.mjs';

const listing = (count = 1) =>
  '<div class="flip-entries">' +
  Array.from(
    { length: count },
    (_, i) =>
      `<a href="https://docs.google.com/document/d/doc-${i}/edit?usp=drive_web"><div class="flip-entry-title">Guide &amp; policy ${i}</div></a>`,
  ).join('') +
  '</div>';
const response = (body, type = 'text/html', status = 200) =>
  new Response(body, { status, headers: { 'content-type': type } });

test('public mode reads only fixed Google endpoints without credentials and preserves source titles', async () => {
  const requests = [];
  const documents = await readPublicDriveKnowledge('folder-1', {
    fetchImpl: async (url, options) => {
      requests.push(url);
      assert.equal(options.headers, undefined);
      assert.ok(options.signal);
      return url.includes('embeddedfolderview')
        ? response(listing())
        : response(' Approved guidance. ', 'text/plain; charset=utf-8');
    },
  });
  assert.deepEqual(documents, [{ title: 'Guide & policy 0', text: 'Approved guidance.' }]);
  assert.deepEqual(requests, [
    'https://drive.google.com/embeddedfolderview?id=folder-1',
    'https://docs.google.com/document/d/doc-0/export?format=txt',
  ]);
});

test('revoked public access and login HTML cannot return stale or fabricated company guidance', async () => {
  let accessible = true;
  const fetchImpl = async (url) =>
    url.includes('embeddedfolderview')
      ? response(listing())
      : accessible
        ? response('Earlier policy', 'text/plain')
        : response('<html>Sign in</html>');
  await readPublicDriveKnowledge('folder-1', { fetchImpl });
  accessible = false;
  await assert.rejects(readPublicDriveKnowledge('folder-1', { fetchImpl }), (error) => {
    assert.equal(driveFailure(error).code, 'DRIVE_PUBLIC_ACCESS_REQUIRED');
    return true;
  });
});

test('public reader rejects changed listing formats, excessive documents and oversized content', async () => {
  for (const [html, text, code] of [
    ['<html>Sign in</html>', '', 'DRIVE_PUBLIC_ACCESS_REQUIRED'],
    [listing(0), '', 'DRIVE_NO_DOCUMENTS'],
    [listing(6), '', 'DRIVE_TOO_MANY_DOCUMENTS'],
    [listing(), '', 'DRIVE_EMPTY_DOCUMENTS'],
    [listing(), 'a'.repeat(120001), 'DRIVE_KNOWLEDGE_TOO_LARGE'],
    [listing(), 'a'.repeat(600001), 'DRIVE_KNOWLEDGE_TOO_LARGE'],
  ]) {
    await assert.rejects(
      readPublicDriveKnowledge('folder-1', {
        fetchImpl: async (url) =>
          url.includes('embeddedfolderview') ? response(html) : response(text, 'text/plain'),
      }),
      (error) => error.code === code,
    );
  }
});

test('public reader rejects invalid folder IDs and sanitizes network errors', async () => {
  await assert.rejects(
    readPublicDriveKnowledge('../other'),
    (e) => e.code === 'DRIVE_FOLDER_INVALID',
  );
  await assert.rejects(
    readPublicDriveKnowledge('folder-1', {
      fetchImpl: async () => {
        throw new Error('private-network-details');
      },
    }),
    (e) =>
      e.code === 'DRIVE_PUBLIC_ACCESS_REQUIRED' && !e.message.includes('private-network-details'),
  );
});
