// Best-effort removal of personal data from free text before it is stored
// anonymously (knowledge gaps, issue #49). MVP patterns only; it is not a
// guarantee (see docs/onboarding-journey.md): emails, Malaysian IC numbers
// (YYMMDD-PB-####, with or without dashes or spaces), Employee IDs such as
// PC-0001, and phone numbers (Malaysian +60 / 01x / 0x landlines, and other
// international numbers). Over-redaction is preferred to a leak.

export const redactionTokens = Object.freeze({
  email: '[email]',
  ic: '[IC number]',
  employeeId: '[employee ID]',
  phone: '[phone]',
});

const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// 12 digits grouped 6-2-4 by dashes or spaces, or run together.
const icPattern = /(?<![\d+])\d{6}[\s-]?\d{2}[\s-]?\d{4}(?!\d)/g;
// Employee IDs: two to four letters, a hyphen and at least four digits.
const employeeIdPattern = /\b[A-Za-z]{2,4}-\d{4,}\b/g;
// A run that starts with + or a digit and continues with digits and the usual
// separators; it is a phone number when it has enough digits.
const phoneCandidate = /(?:\+\s?)?\(?\d[\d\s().-]{5,}\d/g;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function phoneLike(match) {
  const digits = match.replace(/\D/g, '').length;
  if (datePattern.test(match.trim())) return false;
  const international = match.trim().startsWith('+');
  return digits <= 15 && digits >= (international ? 8 : 9);
}

export function redactPersonalData(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(emailPattern, redactionTokens.email)
    .replace(icPattern, redactionTokens.ic)
    .replace(employeeIdPattern, redactionTokens.employeeId)
    .replace(phoneCandidate, (match) => {
      // Keep the separators around the number (a trailing space, say).
      const trimmed = match.replace(/[\s().-]+$/, '');
      return phoneLike(trimmed) ? redactionTokens.phone + match.slice(trimmed.length) : match;
    });
}
