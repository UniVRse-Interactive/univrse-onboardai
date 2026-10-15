import express from 'express';
import { ChatError } from './chat-errors.mjs';
import { accountErrors } from './account-errors.mjs';

// HTTP routes for accounts (see docs/account-access.md for the contract):
//   /api/auth/*           sign in, session, sign out, change password
//   /api/me/*             the signed-in account's own data
//   /api/hr/employees*    HR-only employee administration
// Every route checks the browser's Origin like the saved-chat routes, answers
// 503 ACCOUNTS_NOT_CONFIGURED without DATABASE_URL, is never cached, and sits
// behind the app's POST rate limiter.
export const accountCookie = 'onboardai_account';

export function readCookie(req, name) {
  const prefix = name + '=';
  return req
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(prefix))
    ?.slice(prefix.length);
}

// The same rule as the saved-chat routes: a browser Origin header, when sent,
// must name this host.
export function sameOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === req.host;
  } catch {
    return false;
  }
}

export function accountCookieOptions(req, env) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure || env.NODE_ENV === 'production',
    path: '/api',
  };
}

export function sendAccountError(res, error) {
  res.status(error.status).json({ code: error.code, error: error.message, ...error.details });
}

export function mountAccountRoutes(app, { env, accounts }) {
  const setSession = (req, res, result) =>
    res.cookie(accountCookie, result.token, {
      ...accountCookieOptions(req, env),
      maxAge: result.sessionMs,
    });
  const clearSession = (req, res) => res.clearCookie(accountCookie, accountCookieOptions(req, env));

  function guard(req, res, next) {
    res.set('Cache-Control', 'no-store');
    if (!sameOrigin(req)) throw accountErrors.crossOrigin();
    if (!accounts) throw accountErrors.notConfigured();
    next();
  }
  // Requires a usable session. allowPasswordChange lets an account with a
  // forced password change through (session, change password, sign out only).
  const signedIn =
    ({ allowPasswordChange = false, role = null } = {}) =>
    async (req, res, next) => {
      const token = readCookie(req, accountCookie);
      if (token === undefined) throw accountErrors.authRequired();
      const session = await accounts.session(token);
      if (!session) {
        clearSession(req, res);
        throw accountErrors.sessionExpired();
      }
      if (session.account.mustChangePassword && !allowPasswordChange)
        throw accountErrors.passwordChangeRequired();
      if (role && session.account.role !== role) throw accountErrors.hrRequired();
      req.accountSession = session;
      next();
    };
  const hr = signedIn({ role: 'hr' });

  const auth = express.Router();
  auth.post('/sign-in', async (req, res) => {
    const previous = readCookie(req, accountCookie);
    const result = await accounts.signIn(req.body, previous);
    setSession(req, res, result);
    res.json({ account: result.account });
  });
  auth.get('/session', async (req, res) => {
    const token = readCookie(req, accountCookie);
    if (token === undefined) return res.json({ account: null });
    const session = await accounts.session(token);
    if (!session) {
      clearSession(req, res);
      throw accountErrors.sessionExpired();
    }
    res.json({ account: session.account });
  });
  auth.post('/sign-out', async (req, res) => {
    await accounts.signOut(readCookie(req, accountCookie));
    clearSession(req, res);
    res.status(204).end();
  });
  auth.post('/password', signedIn({ allowPasswordChange: true }), async (req, res) => {
    const result = await accounts.changePassword(req.accountSession, req.body);
    setSession(req, res, result);
    res.json({ account: result.account });
  });

  const me = express.Router();
  me.get('/profile', signedIn(), async (req, res) => {
    res.json({ profile: await accounts.myProfile(req.accountSession.account) });
  });

  const employees = express.Router();
  employees.get('/employees', hr, async (req, res) => {
    res.json({ employees: await accounts.listEmployees() });
  });
  employees.post('/employees', hr, async (req, res) => {
    res.status(201).json({ employee: await accounts.createEmployee(req.accountSession, req.body) });
  });
  employees.get('/employees/:id', hr, async (req, res) => {
    res.json({ employee: await accounts.getEmployee(req.params.id) });
  });
  employees.put('/employees/:id/profile', hr, async (req, res) => {
    res.json({
      employee: await accounts.replaceProfile(req.accountSession, req.params.id, req.body),
    });
  });
  employees.post('/employees/:id/password', hr, async (req, res) => {
    res.json(await accounts.resetPassword(req.accountSession, req.params.id, req.body));
  });
  employees.put('/employees/:id/status', hr, async (req, res) => {
    res.json(await accounts.setStatus(req.accountSession, req.params.id, req.body));
  });

  for (const [path, router] of [
    ['/api/auth', auth],
    ['/api/me', me],
    ['/api/hr', employees],
  ]) {
    const mounted = express.Router();
    mounted.use(guard, router);
    mounted.use(() => {
      throw accountErrors.notFound();
    });
    mounted.use((error, req, res, next) => {
      if (res.headersSent) return next(error);
      if (error instanceof ChatError) return sendAccountError(res, error);
      // Only the error's name and code, never request data or values.
      console.warn(
        'Account request failed: ' +
          JSON.stringify({ name: error?.name, code: String(error?.code || 'UNKNOWN') }),
      );
      res.status(500).json({
        code: 'ACCOUNT_REQUEST_FAILED',
        error: 'The account request could not be completed. Please try again.',
      });
    });
    app.use(path, mounted);
  }
}
