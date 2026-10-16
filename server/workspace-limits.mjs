// Shared by the upload reader, workspace store and web proxy.
export const guestWorkspaceLifetime = 24 * 60 * 60 * 1000;
export const workspaceLimits = {
  files: 12,
  guests: 5,
  bytes: 5 * 1024 * 1024,
  characters: 250000,
  totalCharacters: 750000,
};
// Profile autofill uploads (POST /api/hr/employees/autofill), for the API and web proxy.
export const autofillFileBytes = 5 * 1024 * 1024;
