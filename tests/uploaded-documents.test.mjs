import test from 'node:test';
import assert from 'node:assert/strict';
import { readUploadedDocument } from '../server/read-uploaded-document.mjs';
import { crc32 } from 'node:zlib';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { once } from 'node:events';

// Tiny, synthetic documents exercise the real readers without company data.
function pdf(text) {
  const stream = `BT /F1 12 Tf 40 740 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let output = '%PDF-1.4\n',
    offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(output.length);
    output += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = output.length;
  output +=
    `xref\n0 6\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
      .join('');
  return Buffer.from(output + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}
function docx(text) {
  const entries = {
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
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

test('uploaded PDF, DOCX, Markdown and text files yield readable source text', async () => {
  const guidance = 'Working hours are 10 AM to 6 PM Monday to Friday.';
  for (const [name, buffer] of [
    ['guide.pdf', pdf(guidance)],
    ['guide.docx', docx(guidance)],
    ['guide.md', Buffer.from('# Guide\n' + guidance)],
    ['guide.txt', Buffer.from(guidance)],
  ]) {
    const parsed = await readUploadedDocument(name, buffer);
    assert.match(parsed.text, /10 AM to 6 PM/);
    assert.equal(parsed.name, name);
    assert.equal(parsed.bytes, buffer.length);
  }
});

test('the document reader works when its parent has development watcher flags', async () => {
  const original = [...process.execArgv];
  process.execArgv.push('--watch-path=server');
  try {
    assert.match(
      (await readUploadedDocument('guide.txt', Buffer.from('Office hours are 10 AM to 6 PM.')))
        .text,
      /10 AM/,
    );
  } finally {
    process.execArgv.splice(0, process.execArgv.length, ...original);
  }
});

test('a real Node watch process cannot confuse dependency messages with document results', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'onboardai-reader-watch-'));
  const script = join(folder, 'reader.mjs');
  writeFileSync(
    script,
    `import { readUploadedDocument } from ${JSON.stringify(new URL('../server/read-uploaded-document.mjs', import.meta.url).href)};
    const result = await readUploadedDocument('guide.txt',Buffer.from('Office hours are 10 AM to 6 PM.'));
    if(result.text.includes('10 AM')) console.log('READER_OK');
    process.exit(0);`,
  );
  const child = spawn(process.execPath, ['--watch', '--watch-preserve-output', script], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(
        () => reject(new Error('The watcher did not receive a valid document result.')),
        15000,
      );
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
        if (output.includes('READER_OK')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.stderr.resume();
    });
  } finally {
    const exit = once(child, 'exit');
    child.kill();
    await exit;
    assert.equal(dirname(folder), tmpdir());
    rmSync(folder, { recursive: true, force: true });
  }
});

test('unreadable, disguised, oversized and empty uploads fail safely', async () => {
  const cases = [
    ['../guide.txt', Buffer.from('Some long text about working hours.'), 'FILE_NAME_INVALID'],
    ['guide.html', Buffer.from('<script>bad()</script>'), 'FILE_TYPE_UNSUPPORTED'],
    ['guide.docx', Buffer.from('x'), 'FILE_INVALID'],
    ['guide.pdf', Buffer.from('This is actually a text file.'), 'FILE_INVALID'],
    ['guide.txt', Buffer.alloc(0), 'FILE_EMPTY'],
    ['guide.txt', Buffer.alloc(5 * 1024 * 1024 + 1), 'FILE_TOO_LARGE'],
    ['guide.pdf', pdf(''), 'FILE_NO_TEXT'],
    ['guide.txt', Buffer.from([0xff, 0xfe, 0xff]), 'FILE_UNREADABLE'],
    ['guide.txt', Buffer.from('a'.repeat(250001)), 'FILE_TEXT_TOO_LONG'],
    ['guide.docx', Buffer.from('PKbroken document content'), 'FILE_INVALID'],
  ];
  for (const [name, buffer, code] of cases)
    await assert.rejects(
      readUploadedDocument(name, buffer),
      (error) => error.code === code && !/C:\\|workerData|privatekey/.test(error.message),
    );
});
