// Client-side mirror of server/employee-profiles.mjs. The server stays the
// authority: its PROFILE_INVALID fields[] are shown next to the same inputs.

export const profileGroups = [
  {
    key: 'job',
    title: 'Job details',
    fields: [
      { key: 'fullName', label: 'Full name', max: 120, required: true, autoComplete: 'off' },
      { key: 'preferredName', label: 'Preferred name', max: 80 },
      { key: 'jobTitle', label: 'Job title', max: 120 },
      { key: 'department', label: 'Department', max: 120, kind: 'department' },
      { key: 'startDate', label: 'Start date', max: 10, kind: 'date' },
      { key: 'manager', label: 'Manager', max: 120 },
    ],
  },
  {
    key: 'contact',
    title: 'Contact',
    fields: [
      { key: 'workEmail', label: 'Work email', max: 254, kind: 'email' },
      { key: 'personalEmail', label: 'Personal email', max: 254, kind: 'email' },
      { key: 'mobileNumber', label: 'Mobile', max: 32, kind: 'phone' },
    ],
  },
  {
    key: 'emergencyContact',
    title: 'Emergency contact',
    fields: [
      { key: 'name', label: 'Contact name', max: 120 },
      { key: 'relationship', label: 'Relationship', max: 60 },
      { key: 'phoneNumber', label: 'Contact phone', max: 32, kind: 'phone' },
    ],
  },
  {
    key: 'homeAddress',
    title: 'Home address',
    fields: [
      { key: 'line1', label: 'Address line 1', max: 200 },
      { key: 'line2', label: 'Address line 2', max: 200 },
      { key: 'city', label: 'City', max: 100 },
      { key: 'state', label: 'State', max: 100 },
      { key: 'postcode', label: 'Postcode', max: 20 },
      { key: 'country', label: 'Country', max: 100 },
    ],
  },
];

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[0-9 ().-]*[0-9][0-9 ().-]*$/;
const controlCharacters = /[\u0000-\u001f\u007f]/;

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const emptyProfile = () =>
  Object.fromEntries(
    profileGroups.map((group) => [
      group.key,
      Object.fromEntries(group.fields.map((field) => [field.key, ''])),
    ]),
  );

// A Profile from the API (or null) as editable form values: every field a string.
export function profileToForm(profile) {
  const form = emptyProfile();
  for (const group of profileGroups)
    for (const field of group.fields) {
      const value = profile?.[group.key]?.[field.key];
      form[group.key][field.key] = typeof value === 'string' ? value : '';
    }
  return form;
}

// Form values as a ProfileInput (no updatedAt/updatedBy: the server ignores them).
export function formToProfileInput(form) {
  const input = {};
  for (const group of profileGroups) {
    input[group.key] = {};
    for (const field of group.fields)
      input[group.key][field.key] = String(form?.[group.key]?.[field.key] ?? '').trim();
  }
  return input;
}

function problemFor(text, field) {
  if (!text) return field.required ? 'required' : null;
  if (controlCharacters.test(text)) return 'invalid_characters';
  if ([...text].length > field.max) return 'too_long';
  if (field.kind === 'email' && !emailPattern.test(text)) return 'invalid_email';
  if (field.kind === 'date' && !validDate(text)) return 'invalid_date';
  if (field.kind === 'phone' && !phonePattern.test(text)) return 'invalid_phone';
  return null;
}

// -> [{ field: 'job.fullName', problem: 'required' }]
export function validateProfileForm(form) {
  const input = formToProfileInput(form);
  const problems = [];
  for (const group of profileGroups)
    for (const field of group.fields) {
      const problem = problemFor(input[group.key][field.key], field);
      if (problem) problems.push({ field: `${group.key}.${field.key}`, problem });
    }
  return problems;
}

const problemText = {
  required: 'is required.',
  unknown: 'is not a profile field.',
  not_object: 'is not valid.',
  not_text: 'must be text.',
  invalid_characters: 'cannot contain line breaks or control characters.',
  invalid_email: 'must be a valid email address.',
  invalid_date: 'must be a real date.',
  invalid_department: 'must be one of the listed departments.',
  invalid_phone: 'can only use digits, spaces, + - ( ) and a full stop.',
};

const fieldIndex = new Map(
  profileGroups.flatMap((group) =>
    group.fields.map((field) => [`${group.key}.${field.key}`, field]),
  ),
);

export function problemMessage(field, problem) {
  const def = typeof field === 'string' ? fieldIndex.get(field) : field;
  const label = def?.label || 'This field';
  if (problem === 'too_long') return `${label} must be at most ${def?.max ?? ''} characters.`;
  return `${label} ${problemText[problem] || 'is not valid.'}`;
}

// -> { 'job.startDate': 'Start date must be a real date.' }. Problems naming no
// input (for example `profile`) are returned under `general`.
export function fieldErrors(problems) {
  const errors = {};
  const general = [];
  for (const { field, problem } of problems || []) {
    if (fieldIndex.has(field)) {
      if (!errors[field]) errors[field] = problemMessage(field, problem);
    } else general.push(problemMessage(field, problem));
  }
  return { errors, general };
}

export const usernamePattern = /^[A-Za-z0-9._-]{3,32}$/;
export const passwordLimits = { min: 8, max: 200 };

export function passwordProblem(password, username = '') {
  const length = [...String(password ?? '')].length;
  if (!length) return 'Enter a password.';
  if (length < passwordLimits.min)
    return `Use a password of at least ${passwordLimits.min} characters.`;
  if (length > passwordLimits.max)
    return `Use a password of at most ${passwordLimits.max} characters.`;
  if (username && password.toLowerCase() === username.toLowerCase())
    return 'The password cannot be the same as the ID.';
  return null;
}

// Where a server error code from the HR routes belongs in the add-employee form.
export function employeeErrorTarget(code) {
  if (code === 'USERNAME_TAKEN' || code === 'USERNAME_INVALID') return 'username';
  if (code === 'PASSWORD_REJECTED') return 'temporaryPassword';
  return null;
}
