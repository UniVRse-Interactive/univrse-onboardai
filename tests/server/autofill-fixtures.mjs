// Synthetic files and a fake Vertex AI endpoint for the profile autofill tests.
// Every name, address and number here is invented; no network is used.
import { crc32, deflateSync } from 'node:zlib';

// A one-page PDF. lines: text lines drawn on the page ([] draws nothing, like
// a scan). extraTrailer is added to the trailer dictionary.
export function pdf(lines = [], { extraObjects = [], extraTrailer = '' } = {}) {
  const stream = lines
    .map((line, i) => `BT /F1 12 Tf 40 ${740 - i * 18} Td (${line}) Tj ET`)
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ...extraObjects,
  ];
  let output = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, i) => {
    offsets.push(output.length);
    output += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = output.length;
  output +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  return Buffer.from(
    output +
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${extraTrailer}>>\nstartxref\n${xref}\n%%EOF`,
    'latin1',
  );
}

// A PDF that needs a user password to open (standard security handler, RC4
// 40-bit, with password hashes that no empty password matches).
export function passwordPdf() {
  const hex32 = 'a1'.repeat(32);
  return pdf(['Locked synthetic document'], {
    extraObjects: [
      `<< /Filter /Standard /V 1 /R 2 /O <${hex32}> /U <${'b2'.repeat(32)}> /P -44 >>`,
    ],
    extraTrailer: `/Encrypt 6 0 R /ID [<${'c3'.repeat(16)}> <${'c3'.repeat(16)}>] `,
  });
}

// A minimal DOCX (stored ZIP) with one paragraph per line.
export function docx(lines) {
  const paragraphs = lines.map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('');
  const entries = {
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`,
  };
  const locals = [],
    central = [];
  let offset = 0;
  for (const [path, text] of Object.entries(entries)) {
    const name = Buffer.from(path),
      data = Buffer.from(text),
      local = Buffer.alloc(30),
      header = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt32LE(crc32(data), 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    central.push(header, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(2, 8);
  end.writeUInt16LE(2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// A real 1x1 PNG; padding bytes after IEND make it any larger size.
export function png(size = 0) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4),
      crc = Buffer.alloc(4),
      body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    length.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const image = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 255, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return size > image.length ? Buffer.concat([image, Buffer.alloc(size - image.length)]) : image;
}

// JPEG start-of-image and JFIF header; the fake model never decodes it.
export const jpeg = () =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0synthetic', 'latin1'),
  ]);

// A Windows executable header (MZ ... PE) with NUL bytes, as a renamed .exe.
export const exe = () =>
  Buffer.concat([Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1'), Buffer.alloc(120, 0)]);

// A Vertex AI generateContent response whose text is `answer` (an object is
// sent as JSON; a string is sent as is).
export function geminiResponse(answer, status = 200) {
  const text = typeof answer === 'string' ? answer : JSON.stringify(answer);
  return new Response(
    JSON.stringify({
      candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

// A fake fetch for Vertex AI. respond(call) returns a Response (or throws);
// every call is recorded with its parsed request body.
export function fakeVertex(respond) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const call = {
      url: String(url),
      headers: init.headers,
      request: JSON.parse(init.body),
      signal: init.signal,
    };
    calls.push(call);
    return respond(call);
  };
  return { calls, fetchImpl };
}

// Resolves never, but rejects when the request's signal aborts (like fetch).
export const hangUntilAborted = (call) =>
  new Promise((resolve, reject) => {
    call.signal.addEventListener('abort', () => reject(call.signal.reason), { once: true });
  });
