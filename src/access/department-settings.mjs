// Pure rules for the Settings > Departments panel: the same checks the server
// makes (so HR sees problems while typing), and the mapping of server answers
// onto the two inputs.

export const nameMax = 60;
export const prefixPattern = /^[A-Z]{2,4}$/;
export const reservedPrefixes = Object.freeze(['HR']);

const norm = (value) => String(value ?? '').trim();
const lower = (value) => norm(value).toLowerCase();

// Prefix is typed in any case and kept to 4 characters.
export function normalizePrefix(value) {
  return String(value ?? '')
    .toUpperCase()
    .slice(0, 4);
}

export const problemMessages = {
  name: {
    required: 'Enter a department name.',
    too_long: `The name must be at most ${nameMax} characters.`,
    invalid_format: 'The name must be one line, without line breaks.',
    reserved: 'This name is not available.',
    taken: 'A department with this name already exists.',
  },
  prefix: {
    required: 'Enter a prefix of 2 to 4 letters.',
    too_long: 'The prefix can be at most 4 letters.',
    invalid_format: 'Use 2 to 4 capital letters, A to Z only.',
    reserved: 'HR is reserved for HR accounts. Choose another prefix.',
    taken: 'This prefix is already used by another department.',
  },
};

export function problemMessage(field, problem) {
  return problemMessages[field]?.[problem] || 'This value is not valid.';
}

// First problem code for the name, or null. `departments` is the list to
// compare with (the one being edited is left out by `ignoreId`).
export function nameProblem(value, departments = [], ignoreId = '') {
  const name = norm(value);
  if (!name) return 'required';
  if ([...name].length > nameMax) return 'too_long';
  if (/[\u0000-\u001f\u007f]/.test(name)) return 'invalid_format';
  if (departments.some((d) => d.id !== ignoreId && lower(d.name) === lower(name))) return 'taken';
  return null;
}

export function prefixProblem(value, departments = [], ignoreId = '') {
  const prefix = normalizePrefix(norm(value));
  if (!prefix) return 'required';
  if (!prefixPattern.test(prefix)) return 'invalid_format';
  if (reservedPrefixes.includes(prefix)) return 'reserved';
  if (departments.some((d) => d.id !== ignoreId && d.prefix === prefix)) return 'taken';
  return null;
}

// -> { name?: message, prefix?: message } ; empty object when the form is fine.
export function validateDepartmentForm(form, departments = [], ignoreId = '') {
  const errors = {};
  const name = nameProblem(form?.name, departments, ignoreId);
  if (name) errors.name = problemMessage('name', name);
  const prefix = prefixProblem(form?.prefix, departments, ignoreId);
  if (prefix) errors.prefix = problemMessage('prefix', prefix);
  return errors;
}

// Server answer -> { errors: { name?, prefix? }, summary }. Anything that does
// not belong to an input becomes the summary.
export function serverDepartmentErrors(error) {
  const errors = {};
  let summary = '';
  const fields = Array.isArray(error?.fields) ? error.fields : [];
  if (error?.code === 'DEPARTMENT_INVALID') {
    for (const { field, problem } of fields) {
      if ((field === 'name' || field === 'prefix') && !errors[field])
        errors[field] = problemMessage(field, problem);
    }
    if (!Object.keys(errors).length) summary = error.message || 'The department is not valid.';
  } else if (error?.code === 'DEPARTMENT_NAME_TAKEN') errors.name = problemMessage('name', 'taken');
  else if (error?.code === 'DEPARTMENT_PREFIX_TAKEN')
    errors.prefix = problemMessage('prefix', 'taken');
  else summary = error?.message || 'The request could not be completed. Please try again.';
  return { errors, summary };
}

// "IDs look like XX-0001" while typing; XX stands in until a prefix is typed.
export function prefixPreview(prefix) {
  const value = normalizePrefix(norm(prefix));
  return `IDs look like ${value || 'XX'}-0001`;
}

// Notes under the edit inputs. `original` is the saved department, `draft` the form.
export function editNotes(original, draft) {
  const notes = {};
  const prefix = normalizePrefix(norm(draft?.prefix));
  if (prefix && prefix !== original?.prefix)
    notes.prefix = `Existing Employee IDs stay the same. New hires get ${prefix}-…`;
  const name = norm(draft?.name);
  if (name && name !== original?.name)
    notes.name = 'Employees in this department will be relabelled.';
  return notes;
}

export function hasChanges(original, draft) {
  return (
    norm(draft?.name) !== original?.name ||
    normalizePrefix(norm(draft?.prefix)) !== original?.prefix
  );
}

// Only the fields that changed go to PATCH.
export function patchBody(original, draft) {
  const body = {};
  if (norm(draft?.name) !== original?.name) body.name = norm(draft.name);
  const prefix = normalizePrefix(norm(draft?.prefix));
  if (prefix !== original?.prefix) body.prefix = prefix;
  return body;
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

export function addedMessage(department) {
  return `Added ${department.name}. New Employee IDs start with ${department.prefix}-.`;
}

export function savedMessage(name, updatedProfiles = 0) {
  const count = Number(updatedProfiles) || 0;
  return `Saved ${name}. ${plural(count, 'employee profile', 'employee profiles')} updated.`;
}

export function archiveNote(department) {
  return `${department.name} will be hidden from the department choices for new hires. Employees who are already in it keep it, and their Employee IDs do not change.`;
}

export const restoreNote = (department) =>
  `${department.name} will appear again in the department choices for new hires.`;

export function archivedMessage(name, archived) {
  return archived ? `Archived ${name}.` : `Restored ${name}.`;
}

export const statusLabel = (department) => (department?.archived ? 'Archived' : 'Active');

export function employeesLabel(count) {
  return String(Number(count) || 0);
}
