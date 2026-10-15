import { parentPort, workerData } from 'node:worker_threads';

const { extension, maxCharacters } = workerData;
const buffer = Buffer.from(workerData.buffer);
const fail = (code, error) => {
  throw Object.assign(new Error(error), { code });
};

// Check DOCX expansion before the parser reads compressed XML. No file is
// extracted to disk and document references cannot read local files.
function checkWordArchive() {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--)
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) fail('FILE_INVALID', 'This Word archive is incomplete. Export a fresh DOCX file.');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16),
    expanded = 0;
  if (count > 1000) fail('FILE_TOO_COMPLEX', 'This Word file is too complex. Upload a text copy.');
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50)
      fail('FILE_INVALID', 'This Word archive could not be read.');
    expanded += buffer.readUInt32LE(offset + 24);
    if (expanded > 20 * 1024 * 1024 || buffer.readUInt16LE(offset + 8) & 1)
      fail('FILE_TOO_COMPLEX', 'Use an unencrypted Word file with less embedded content.');
    offset +=
      46 +
      buffer.readUInt16LE(offset + 28) +
      buffer.readUInt16LE(offset + 30) +
      buffer.readUInt16LE(offset + 32);
  }
}
try {
  let text = '';
  if (extension === '.txt' || extension === '.md') {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    if (text.includes('\0')) fail('FILE_INVALID', 'Upload a UTF-8 text file.');
  } else if (extension === '.docx') {
    checkWordArchive();
    const { default: mammoth } = await import('mammoth');
    text = (await mammoth.extractRawText({ buffer })).value;
  } else {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      verbosity: 0,
      useSystemFonts: false,
      stopAtErrors: true,
    });
    let document;
    try {
      document = await loading.promise;
      if (document.numPages > 150)
        fail(
          'FILE_TOO_COMPLEX',
          'Upload a PDF of up to 150 pages, or divide it into shorter guides.',
        );
      for (let i = 1; i <= document.numPages; i++) {
        const page = await document.getPage(i),
          content = await page.getTextContent();
        text +=
          content.items
            .map((item) =>
              typeof item.str === 'string' ? item.str + (item.hasEOL ? '\n' : ' ') : '',
            )
            .join('') + '\n\n';
        if (text.length > maxCharacters)
          fail('FILE_TEXT_TOO_LONG', 'Upload a shorter guide; this file contains too much text.');
        page.cleanup();
      }
    } finally {
      await loading.destroy();
    }
  }
  text = text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim();
  if (text.length < 20)
    fail(
      'FILE_NO_TEXT',
      'No readable guidance was found. Scanned PDFs need a text-based PDF or DOCX copy.',
    );
  if (text.length > maxCharacters)
    fail('FILE_TEXT_TOO_LONG', 'Upload a shorter guide; this file contains too much text.');
  parentPort.postMessage({ type: 'document-result', text });
} catch (error) {
  const known = typeof error.code === 'string' && error.code.startsWith('FILE_');
  parentPort.postMessage({
    type: 'document-result',
    code: known ? error.code : 'FILE_UNREADABLE',
    error: known
      ? error.message
      : 'The file could not be read. Use an unencrypted PDF, DOCX or UTF-8 text copy.',
  });
}
