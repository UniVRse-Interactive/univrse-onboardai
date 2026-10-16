// The six departments the database starts with, and their Employee ID prefixes
// (migration 004_departments.sql seeds the same list). This is seed data only:
// the departments table is the source of truth, and HR changes it in Settings,
// so nothing at runtime reads this list except as a fallback in tests.
export const departments = Object.freeze([
  { name: 'Product & Engineering', prefix: 'PE' },
  { name: 'Customer Success', prefix: 'CS' },
  { name: 'Sales & Marketing', prefix: 'SM' },
  { name: 'Finance', prefix: 'FN' },
  { name: 'People & Culture', prefix: 'PC' },
  { name: 'Operations & Facilities', prefix: 'OF' },
]);
