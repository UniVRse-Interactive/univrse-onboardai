// Anonymous, read-only access for folders deliberately shared with anyone.
// Uses Google's public folder listing and Google Docs text export, not OAuth.
// The listing is HTML, so fail closed if its structure changes. Never cache
// document bodies: revoked sharing must not leave stale company answers usable.
export class PublicDriveError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PublicDriveError';
    this.code = code;
  }
}

const unavailable = () =>
  new PublicDriveError(
    'DRIVE_PUBLIC_ACCESS_REQUIRED',
    'The public company folder or a document cannot be read. Check that the folder and its Google Docs allow anyone with the link to view and download, or configure authenticated Drive access.',
  );

async function readPublicText(url, type, byteLimit, fetchImpl) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
    const finalUrl = new URL(response.url || url);
    const hostAllowed =
      type === 'text/html'
        ? finalUrl.hostname === 'drive.google.com'
        : finalUrl.hostname === 'docs.google.com' ||
          finalUrl.hostname.endsWith('.googleusercontent.com');
    if (
      !response.ok ||
      finalUrl.protocol !== 'https:' ||
      !hostAllowed ||
      !response.headers.get('content-type')?.toLowerCase().startsWith(type)
    ) {
      await response.body?.cancel();
      throw unavailable();
    }
    const reader = response.body?.getReader();
    if (!reader) throw unavailable();
    const decoder = new TextDecoder();
    let size = 0,
      text = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > byteLimit) {
          await reader.cancel();
          throw new PublicDriveError(
            'DRIVE_KNOWLEDGE_TOO_LARGE',
            'The shared company content is too large. Reduce it before trying again.',
          );
        }
        text += decoder.decode(value, { stream: true });
      }
      return text + decoder.decode();
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    if (error instanceof PublicDriveError) throw error;
    throw unavailable();
  }
}

function titleText(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (full, entity) => {
      const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      if (entity[0] !== '#') return named[entity.toLowerCase()] || full;
      const n =
        entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .trim()
    .slice(0, 300);
}

export async function readPublicDriveKnowledge(folderId, { fetchImpl = fetch } = {}) {
  if (!/^[A-Za-z0-9_-]+$/.test(folderId || ''))
    throw new PublicDriveError(
      'DRIVE_FOLDER_INVALID',
      'Set a valid Google Drive knowledge folder ID before asking a company question.',
    );
  const html = await readPublicText(
    'https://drive.google.com/embeddedfolderview?id=' + encodeURIComponent(folderId),
    'text/html',
    1_000_000,
    fetchImpl,
  );
  if (!/class=["'][^"']*\bflip-entries\b/.test(html)) throw unavailable();
  const files = new Map();
  for (const link of html.matchAll(
    /<a\b[^>]*href="https:\/\/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]+)\/[^\"]*"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const title = link[2].match(/<div\b[^>]*class="flip-entry-title"[^>]*>([\s\S]*?)<\/div>/i);
    if (!title) throw unavailable();
    files.set(link[1], titleText(title[1]) || 'Company document');
  }
  if (files.size > 5)
    throw new PublicDriveError(
      'DRIVE_TOO_MANY_DOCUMENTS',
      'This preview reads up to five Google Docs directly inside the knowledge folder. Reduce the document count before trying again.',
    );
  if (!files.size)
    throw new PublicDriveError(
      'DRIVE_NO_DOCUMENTS',
      'No public Google Docs were found directly inside the knowledge folder. Check the documents and their sharing settings.',
    );
  const documents = await Promise.all(
    [...files].map(async ([id, title]) => ({
      title,
      text: (
        await readPublicText(
          'https://docs.google.com/document/d/' + id + '/export?format=txt',
          'text/plain',
          600_000,
          fetchImpl,
        )
      ).trim(),
    })),
  );
  const readable = documents.filter((d) => d.text);
  if (!readable.length)
    throw new PublicDriveError(
      'DRIVE_EMPTY_DOCUMENTS',
      'The shared Google Docs are empty. Add company guidance and wait for it to save, then try again.',
    );
  if (readable.reduce((sum, d) => sum + d.text.length, 0) > 120000)
    throw new PublicDriveError(
      'DRIVE_KNOWLEDGE_TOO_LARGE',
      'This preview supports 120,000 characters of company guidance. Reduce the document size before trying again.',
    );
  return readable;
}
