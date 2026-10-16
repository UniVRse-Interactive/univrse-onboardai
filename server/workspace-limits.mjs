// Upload limits shared by the document reader, the HR company knowledge
// library and the web proxy.
export const workspaceLimits = {
  files: 12,
  bytes: 5 * 1024 * 1024,
  characters: 250000,
  totalCharacters: 750000,
};
// Profile autofill uploads (POST /api/hr/employees/autofill), for the API and web proxy.
export const autofillFileBytes = 5 * 1024 * 1024;
