// Employee IDs assigned by the server (issue #34): the department's prefix (2 to
// 4 capital letters, kept in the departments table, issue #36) and a number
// counted per prefix, zero-padded to four digits (PE-0001 ... PE-9999, then
// PE-10000). The numbers come from employee_id_counters (account-store.mjs).
export const prefixPattern = /^[A-Z]{2,4}$/;
// Reserved for HR accounts (HR-0001): no department may use it.
export const reservedPrefix = 'HR';
export const formatEmployeeId = (prefix, number) => `${prefix}-${String(number).padStart(4, '0')}`;
