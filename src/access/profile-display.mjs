import { profileGroups } from './profile-validation.mjs';
import { trackLabel } from './hr-journey.mjs';

export function formatDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDay(value) {
  if (!value) return '';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T00:00:00Z' : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

// Read-only rows for a Profile: [{ title, rows: [{ label, value }] }].
export function profileSections(profile) {
  return profileGroups.map((group) => ({
    key: group.key,
    title: group.title,
    rows: group.fields.map((field) => {
      const value = profile?.[group.key]?.[field.key] || '';
      return {
        key: field.key,
        label: field.label,
        value:
          field.kind === 'date'
            ? formatDay(value)
            : field.kind === 'track'
              ? trackLabel(profile?.[group.key]?.[field.key])
              : value,
      };
    }),
  }));
}

// Display name for an employee row: full name, with the preferred name when different.
export function employeeNames(summary) {
  const fullName = summary?.fullName || '';
  const preferred = summary?.preferredName || '';
  return { fullName, preferredName: preferred && preferred !== fullName ? preferred : '' };
}

// Badges shown for an account in the HR list.
export function accountBadges(account) {
  const badges = [];
  badges.push(account.status === 'disabled' ? 'Disabled' : 'Active');
  if (account.mustChangePassword) badges.push('Must change password');
  if (account.locked) badges.push('Locked');
  return badges;
}
