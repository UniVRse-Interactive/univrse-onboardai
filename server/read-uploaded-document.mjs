import { Worker } from 'node:worker_threads';
import { extname } from 'node:path';
import { ChatError } from './saved-conversations.mjs';
import { workspaceLimits } from './guest-workspace-store.mjs';

let activeReaders = 0;
// truncate: keep the first workspaceLimits.characters characters of a longer
// document instead of rejecting it (profile autofill). Guest uploads reject.
// timeoutMs bounds the reader (FILE_READ_TIMEOUT); tests may lift it.
export async function readUploadedDocument(
  name,
  buffer,
  { truncate = false, timeoutMs = 20000 } = {},
) {
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.length > 180 ||
    /[\\/\u0000-\u001f\u007f]/.test(name)
  )
    throw new ChatError(
      400,
      'FILE_NAME_INVALID',
      'Use a file name of up to 180 characters without a folder path.',
    );
  if (!Buffer.isBuffer(buffer) || !buffer.length)
    throw new ChatError(400, 'FILE_EMPTY', 'Choose a file containing company guidance.');
  if (buffer.length > workspaceLimits.bytes)
    throw new ChatError(413, 'FILE_TOO_LARGE', 'Each file must be 5 MB or smaller.');
  const extension = extname(name).toLowerCase();
  if (!['.pdf', '.docx', '.txt', '.md'].includes(extension))
    throw new ChatError(
      415,
      'FILE_TYPE_UNSUPPORTED',
      'Upload a PDF, Word (.docx), text or Markdown file.',
    );
  if (
    (extension === '.pdf' && buffer.subarray(0, 5).toString() !== '%PDF-') ||
    (extension === '.docx' && (buffer.length < 2 || buffer.readUInt16LE(0) !== 0x4b50))
  )
    throw new ChatError(
      422,
      'FILE_INVALID',
      'This file does not match its type. Export a fresh PDF, DOCX or text copy.',
    );
  if (activeReaders >= 2)
    throw new ChatError(
      503,
      'FILE_READER_BUSY',
      'Two files are being prepared. Please try again shortly.',
    );
  activeReaders++;
  try {
    const text = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./uploaded-document-worker.mjs', import.meta.url), {
        workerData: {
          extension,
          buffer,
          maxCharacters: workspaceLimits.characters,
          truncate: truncate === true,
        },
        // The reader must not inherit the development server's --watch flags.
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 128 },
      });
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(
        () =>
          finish(
            new ChatError(
              422,
              'FILE_READ_TIMEOUT',
              'This file took too long to read. Try a smaller PDF, DOCX or text copy.',
            ),
          ),
        timeoutMs,
      );
      worker.on('message', (message) => {
        // Node's file watcher can also send dependency notifications. Only a
        // reader result may complete this upload.
        if (message?.type !== 'document-result') return;
        if (message.error)
          finish(new ChatError(422, message.code || 'FILE_UNREADABLE', message.error));
        else if (typeof message.text === 'string') finish(null, message.text);
        else
          finish(
            new ChatError(
              422,
              'FILE_UNREADABLE',
              'The document reader returned no text. Try a fresh copy.',
            ),
          );
      });
      worker.once('error', () =>
        finish(
          new ChatError(
            422,
            'FILE_UNREADABLE',
            'The document could not be read. Try exporting it as a fresh PDF or text file.',
          ),
        ),
      );
      worker.once('exit', () => {
        if (!settled)
          finish(
            new ChatError(
              422,
              'FILE_UNREADABLE',
              'The document reader stopped. Try a smaller file.',
            ),
          );
      });
    });
    return { name: name.trim(), text, bytes: buffer.length };
  } finally {
    activeReaders--;
  }
}
