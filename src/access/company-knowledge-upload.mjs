// Pure helpers and user-facing text for the HR Company knowledge upload page.
export const acceptedExtensions = ['.pdf', '.docx', '.txt', '.md'];
export const acceptAttribute = acceptedExtensions.join(',');
export const maxUploadBytes = 5 * 1024 * 1024;
export const maxNameLength = 80;

export const knowledgeText = {
  heading: 'Add your guide.',
  replaceHeading: 'Replace this guide.',
  hint: 'Upload a PDF, Word (.docx), text or Markdown file, up to 5 MB.',
  privacy: 'The text is shared with every employee’s Alya. The original file is not kept.',
  uploadAction: 'Upload document',
  replaceAction: 'Replace document',
  removeAction: 'Remove',
  confirmRemove: 'Remove this guide? New answers will use the remaining company guidance.',
  addAnother: 'Add another document',
  nameLabel: 'Guide name',
  namePlaceholder: 'For example, Workplace Safety',
  chooseFile: 'Choose a file',
  connected: 'Connected',
  limitReached: 'Your library is full. Remove an unused guide first.',
};

export function formatCharacters(count) {
  return Number(count || 0).toLocaleString('en-US') + ' characters';
}

// Returns an error message, or '' when the name is acceptable.
export function validateAdditionalName(value) {
  const name = String(value ?? '').trim();
  if (!name) return 'Give this guide a name first.';
  if (name.length > maxNameLength) return `Keep the name to ${maxNameLength} characters or fewer.`;
  if (/[\r\n]/.test(name)) return 'Use a single line for the name.';
  return '';
}

// Returns an error message, or '' when the file can be sent.
export function validateUploadFile(file) {
  if (!file) return 'Choose a file to upload.';
  const dot = String(file.name || '').lastIndexOf('.');
  const extension = dot < 0 ? '' : file.name.slice(dot).toLowerCase();
  if (!acceptedExtensions.includes(extension))
    return 'Upload a PDF, Word (.docx), text or Markdown file.';
  if (!file.size) return 'That file is empty.';
  if (file.size > maxUploadBytes) return 'That file is larger than 5 MB.';
  return '';
}

// Describes the upload request; the caller passes it to the request adapter.
export function buildUploadRequest(base, { category, name }, file) {
  const query = new URLSearchParams({ category });
  if (category === 'additional') query.set('name', String(name).trim());
  return {
    url: base.replace(/\/+$/, '') + '/documents?' + query.toString(),
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name),
    },
    rawBody: file,
  };
}

export function uploadSuccessMessage(result, fileName) {
  if (result?.duplicate) return 'This document is already in the library.';
  if (result?.replaced) return `Replaced with ${fileName}. Alya will use it in the next answer.`;
  return `Uploaded ${fileName}. Alya will use it in the next answer.`;
}
