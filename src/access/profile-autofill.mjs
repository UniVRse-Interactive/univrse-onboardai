// Pure logic for "Autofill from document" (POST /api/hr/employees/autofill).
// Nothing here is saved: it only decides what to put in the form for HR to review.
import { profileGroups } from './profile-validation.mjs';

export const autofillMaxBytes = 5 * 1024 * 1024;
export const autofillExtensions = ['.pdf', '.docx', '.txt', '.md', '.jpg', '.jpeg', '.png'];
export const autofillAccept = autofillExtensions.join(',');
export const autofillPrivacyNote =
  "The file is sent to Gemini on Google Cloud to read it. It isn't saved.";
export const autofillDisabledNote = 'Autofill needs Gemini to be configured on the server.';

const fieldIndex = new Map(
  profileGroups.flatMap((group) =>
    group.fields.map((field) => [`${group.key}.${field.key}`, { ...field, group: group.key }]),
  ),
);

export const isProfilePath = (path) => fieldIndex.has(path);

// -> an error message, or null when the file can be sent.
export function checkAutofillFile(file) {
  if (!file || !file.name) return 'Choose a file to read.';
  const name = String(file.name).toLowerCase();
  const dot = name.lastIndexOf('.');
  const extension = dot >= 0 ? name.slice(dot) : '';
  if (!autofillExtensions.includes(extension))
    return 'That file type is not supported. Use a PDF, Word (.docx), text, Markdown, JPG or PNG file.';
  if (!(file.size > 0)) return 'That file is empty.';
  if (file.size > autofillMaxBytes) return 'That file is larger than 5 MB. Use a smaller file.';
  return null;
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

// Fills only the empty form fields from result.profile. Employee ID and the
// password fields are not profile fields, so they are never touched.
// -> { form, filled: ['job.fullName'], skipped: ['contact.workEmail'] }
// `filled` is the server's `filled` list narrowed to the fields actually filled
// here. `skipped` are fields the document had a value for but HR had typed.
export function mergeAutofill(form, result) {
  const next = {};
  for (const group of profileGroups) next[group.key] = { ...(form?.[group.key] || {}) };
  const serverFilled = new Set(Array.isArray(result?.filled) ? result.filled : []);
  const filled = [];
  const skipped = [];
  for (const group of profileGroups)
    for (const field of group.fields) {
      const path = `${group.key}.${field.key}`;
      const found = text(result?.profile?.[group.key]?.[field.key]);
      if (!found || !serverFilled.has(path)) continue;
      if (text(next[group.key][field.key])) skipped.push(path);
      else {
        next[group.key][field.key] = found;
        filled.push(path);
      }
    }
  return { form: next, filled, skipped };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function autofillSummary({ filled, skipped, fileName, dropped = [] }) {
  const base = filled.length
    ? `Filled ${plural(filled.length, 'field')} from ${fileName}. Check them before saving.`
    : `Nothing new was filled from ${fileName}.`;
  const parts = [base];
  if (skipped.length)
    parts.push(`Skipped ${plural(skipped.length, 'field')} you had already filled in.`);
  if (dropped.length)
    parts.push(
      `${plural(dropped.length, 'value')} in the document wasn't valid and was left out: ${dropped.join(', ')}.`,
    );
  return parts.join(' ');
}

const problemPhrase = {
  too_long: 'was too long',
  invalid_characters: 'had characters that are not allowed',
  invalid_email: "wasn't valid",
  invalid_date: "wasn't a valid date",
  invalid_phone: "wasn't a valid phone number",
};

// Server warnings -> { 'contact.workEmail': "The document's work email wasn't valid, ..." }
// Only for known fields that are still empty (a field HR filled needs no note).
export function warningNotes(warnings, form) {
  const notes = {};
  for (const { field, problem } of Array.isArray(warnings) ? warnings : []) {
    const def = fieldIndex.get(field);
    if (!def || notes[field]) continue;
    if (text(form?.[def.group]?.[def.key])) continue;
    const phrase = problemPhrase[problem] || "wasn't usable";
    notes[field] = `The document's ${def.label.toLowerCase()} ${phrase}, so it was left empty.`;
  }
  return notes;
}

// Labels of fields with a warning that already hold text (typed by HR), so they
// get no per-field note. -> ['Personal email']
export function droppedLabels(warnings, form) {
  const labels = [];
  for (const { field } of Array.isArray(warnings) ? warnings : []) {
    const def = fieldIndex.get(field);
    if (def && text(form?.[def.group]?.[def.key]) && !labels.includes(def.label))
      labels.push(def.label);
  }
  return labels;
}

// Editing a field removes its "from document" mark and its warning note.
export function clearFieldMarks(state, path) {
  if (!state.marks[path] && !state.notes[path]) return state;
  const marks = { ...state.marks };
  const notes = { ...state.notes };
  delete marks[path];
  delete notes[path];
  return { marks, notes };
}

export const emptyAutofillState = () => ({ marks: {}, notes: {} });

// After a fill: earlier marks stay until edited, new ones are added, notes are replaced.
export function markFilled(state, filled, notes) {
  return {
    marks: { ...state.marks, ...Object.fromEntries(filled.map((path) => [path, true])) },
    notes,
  };
}

const errorMessages = {
  AUTOFILL_UNAVAILABLE: "Gemini couldn't read the file right now. Try again in a moment.",
};

// -> text to show next to the control. The server's own message is fixed and safe.
export function autofillErrorMessage(error) {
  const code = error?.code || '';
  if (errorMessages[code]) return errorMessages[code];
  if (error?.message) return error.message;
  return "Gemini couldn't read the file right now. Try again in a moment.";
}
