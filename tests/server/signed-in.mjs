// Chat, saved conversations, voice and tts need a signed-in account (issue
// #55). Tests that start createApp without the accounts database use this
// stand-in account service: each token below is one signed-in account.
// Synthetic values only.
export const accountTokens = Object.freeze({
  a: 'a'.repeat(64),
  b: 'b'.repeat(64),
  hr: 'c'.repeat(64),
});
const people = {
  [accountTokens.a]: {
    id: '00000000-0000-4000-8000-00000000000a',
    username: 'PC-0001',
    role: 'employee',
  },
  [accountTokens.b]: {
    id: '00000000-0000-4000-8000-00000000000b',
    username: 'PC-0002',
    role: 'employee',
  },
  [accountTokens.hr]: {
    id: '00000000-0000-4000-8000-00000000000c',
    username: 'HR-0001',
    role: 'hr',
  },
};
export const accountCookieFor = (who = 'a') => `onboardai_account=${accountTokens[who]}`;
export const ownerFor = (who = 'a') => `account:${people[accountTokens[who]].id}`;

export function stubAccounts() {
  return {
    session: async (token) =>
      people[token]
        ? {
            account: { ...people[token], mustChangePassword: false, sessionExpiresAt: null },
            tokenHash: 'synthetic',
          }
        : null,
    activeDepartmentNames: async () => [],
    close: async () => {},
  };
}

// fetch that sends account `who`'s cookie unless the request sets a cookie.
export function signedInFetch(who = 'a') {
  return (url, options = {}) => {
    const headers = new Headers(options.headers || {});
    if (!headers.has('cookie')) headers.set('cookie', accountCookieFor(who));
    return globalThis.fetch(url, { ...options, headers });
  };
}
