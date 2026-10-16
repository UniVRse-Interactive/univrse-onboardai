import { departments } from './departments.mjs';

// Employee IDs assigned by the server (issue #34): the department's two-letter
// prefix and a number counted per prefix, zero-padded to four digits
// (PE-0001 ... PE-9999, then PE-10000). The numbers come from
// employee_id_counters (account-store.mjs, migration 003).
export const departmentNames = Object.freeze(departments.map((department) => department.name));
const prefixes = new Map(departments.map((department) => [department.name, department.prefix]));

export const isDepartment = (name) => typeof name === 'string' && prefixes.has(name);
// The prefix for one of the six department names, else null.
export const departmentPrefix = (name) => (isDepartment(name) ? prefixes.get(name) : null);
export const prefixPattern = /^[A-Z]{2}$/;
export const formatEmployeeId = (prefix, number) => `${prefix}-${String(number).padStart(4, '0')}`;
