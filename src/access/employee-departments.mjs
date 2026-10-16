// Department choices and the pieces of the "create employee" flow that need no
// DOM, so they can be unit-tested. The department list is shared with the server.
import { departments } from '../../server/departments.mjs';

export { departments };

export const departmentPlaceholder = 'Choose department';
export const departmentRequiredMessage = 'Choose a department.';
export const autoIdNote =
  'The Employee ID and a temporary password are created automatically from the department.';

const norm = (value) => String(value ?? '').trim();

export function isKnownDepartment(value) {
  return departments.some((department) => department.name === norm(value));
}

// Options for the Department <select>. `legacy` is the stored value of an
// employee being edited: when it is not one of the six, it comes first as
// "<text> (current)" so HR can keep it.
// -> [{ value, label, legacy? }]
export function departmentOptions(legacy = '') {
  const options = departments.map(({ name }) => ({ value: name, label: name }));
  const current = norm(legacy);
  if (current && !isKnownDepartment(current))
    options.unshift({ value: current, label: `${current} (current)`, legacy: true });
  return options;
}

// The value the <select> should show: '' (placeholder) when nothing usable.
export function selectedDepartment(value, legacy = '') {
  const current = norm(value);
  return departmentOptions(legacy).some((option) => option.value === current) ? current : '';
}

// Client check for the add form; the server re-checks. -> message or null
export function departmentProblem(form) {
  return isKnownDepartment(form?.job?.department) ? null : departmentRequiredMessage;
}

// "IDs look like PE-0001" for the chosen department, '' when none chosen.
export function idFormatHint(department) {
  const match = departments.find((item) => item.name === norm(department));
  return match ? `IDs look like ${match.prefix}-0001` : '';
}

// The create request carries the profile only: the server assigns ID and password.
export function createEmployeeBody(profile) {
  return { profile };
}

export function copyBothText({ username, temporaryPassword }) {
  return `Employee ID: ${username}\nTemporary password: ${temporaryPassword}`;
}

export const manualCopyMessage = 'Press ⌘C / Ctrl+C to copy';

// Tries the async clipboard; falls back to "select the text" when it is missing
// or refuses. -> { copied: boolean, fallback: boolean }
export async function copyToClipboard(text, clipboard = globalThis.navigator?.clipboard) {
  if (!clipboard || typeof clipboard.writeText !== 'function')
    return { copied: false, fallback: true };
  try {
    await clipboard.writeText(text);
    return { copied: true, fallback: false };
  } catch {
    return { copied: false, fallback: true };
  }
}

export function copyStatusMessage(what, result) {
  return result.copied ? `Copied ${what}` : manualCopyMessage;
}
