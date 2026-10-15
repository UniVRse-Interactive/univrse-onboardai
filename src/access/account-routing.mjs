// Which screen a signed-in or signed-out browser sees for a path.

export const landingPath = (account) => (account?.role === 'hr' ? '/hr' : '/mira');

const loginPaths = ['/', '/login'];
// Paths whose content depends on the account, so they wait for the session check.
const gatedPaths = ['/', '/login', '/signup', '/hr', '/hr-preview', '/profile'];

// accounts: true | false | null (null while /api/config is loading).
// account: the SessionAccount, or null when signed out.
export function routeDecision({ accounts, loading = false, account = null, path }) {
  if (accounts === false) return { type: 'render' };
  if (accounts === null || loading)
    return gatedPaths.includes(path) ? { type: 'loading' } : { type: 'render' };
  if (account?.mustChangePassword === true) return { type: 'change-password' };
  if (path === '/signup')
    return { type: 'redirect', to: account ? landingPath(account) : '/login' };
  if (loginPaths.includes(path) && account) return { type: 'redirect', to: landingPath(account) };
  if (path === '/profile' && !account) return { type: 'redirect', to: '/login' };
  return { type: 'render' };
}

// Result of an app-wide account error action, given the current session.
export function afterAccountAction(action, account) {
  if (action === 'sign-in') return { account: null, to: '/login', notice: true };
  if (action === 'change-password' && account)
    return { account: { ...account, mustChangePassword: true }, to: null, notice: false };
  return { account, to: null, notice: false };
}
