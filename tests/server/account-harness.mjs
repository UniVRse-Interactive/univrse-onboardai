// Shared set-up for the account tests: the app with accounts on, PostgreSQL in
// pg-mem (real migrations), Firestore in the in-memory fake, a movable clock,
// cheaper scrypt parameters, and cookie-jar browsers. Synthetic data only.
import { once } from 'node:events';
import { AIMessage } from '@langchain/core/messages';
import { createApp } from '../../server/api-routes.mjs';
import { createAccountService } from '../../server/account-service.mjs';
import { createAccountStore } from '../../server/account-store.mjs';
import { createCompanyDocumentStore } from '../../server/company-documents.mjs';
import { createProfileStore } from '../../server/employee-profiles.mjs';
import { createProfileAutofill } from '../../server/profile-autofill.mjs';
import { createFirestoreChatMemory } from '../../server/firestore-chat-memory.mjs';
import { createConversationService } from '../../server/gemini-chat-workflow.mjs';
import { hashPassword, verifyPassword } from '../../server/password-hashing.mjs';
import { FakeFirestore } from './fake-firestore.mjs';
import { createTestDatabase } from './test-database.mjs';

// Same format and code path as production, with less work per hash.
export const fastScrypt = Object.freeze({ n: 1024, r: 8, p: 1, keyLength: 64 });
export function countingHashing() {
  const counts = { hash: 0, verify: 0 };
  const dummy = hashPassword('synthetic-dummy-password', fastScrypt);
  return {
    counts,
    hash: (password) => {
      counts.hash++;
      return hashPassword(password, fastScrypt);
    },
    verify: (password, stored) => {
      counts.verify++;
      return verifyPassword(password, stored);
    },
    dummy: () => dummy,
  };
}

// The settings accounts require; the fake Firestore is injected, so the
// emulator host is never contacted.
export const accountEnv = Object.freeze({
  DATABASE_URL: 'postgresql://onboardai:synthetic-db-secret@127.0.0.1:1/onboardai',
  FIRESTORE_DATABASE_ID: '(default)',
  FIRESTORE_PROJECT_ID: 'demo-test',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:1',
});

export function testClock(start = '2026-10-15T01:00:00.000Z') {
  let at = Date.parse(start);
  return { now: () => new Date(at), advance: (ms) => (at += ms) };
}

export const fakeModels = () => ({
  plan: { invoke: async () => ({ kind: 'company', query: 'dress code', clarification: '' }) },
  answer: { invoke: async () => ({ answer: 'Business casual clothing.', citations: [1] }) },
  summarize: { invoke: async () => new AIMessage('Earlier questions.') },
});
export const fakeRetrieve = async () => [
  { title: 'Synthetic handbook', heading: 'Dress', text: 'Business casual clothing.' },
];

export const syntheticProfile = (fullName = 'Avery Example') => ({
  job: {
    fullName,
    preferredName: 'Avery',
    jobTitle: 'Onboarding Analyst',
    department: 'People Operations',
    startDate: '2026-11-02',
    manager: 'Jordan Sample',
  },
  contact: {
    workEmail: 'avery.example@example.com',
    personalEmail: 'avery.home@example.org',
    mobileNumber: '+65 5550 0101',
  },
  emergencyContact: {
    name: 'Riley Example',
    relationship: 'Sibling',
    phoneNumber: '+65 5550 0102',
  },
  homeAddress: {
    line1: '1 Example Street',
    line2: '#01-01',
    city: 'Sample City',
    state: 'Sample State',
    postcode: '000001',
    country: 'Exampleland',
  },
});

// A browser: keeps cookies between requests like a real one (Path=/api only).
export class Browser {
  constructor(url) {
    this.url = url;
    this.cookies = new Map();
  }
  get cookieHeader() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
  // A second browser holding a copy of this one's cookies (a stolen or old cookie).
  copy() {
    const other = new Browser(this.url);
    other.cookies = new Map(this.cookies);
    return other;
  }
  remember(response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';').map((part) => part.trim());
      const name = pair.slice(0, pair.indexOf('=')),
        value = pair.slice(pair.indexOf('=') + 1);
      const gone = attributes.some(
        (a) =>
          /^max-age=0$/i.test(a) || (/^expires=/i.test(a) && Date.parse(a.slice(8)) <= Date.now()),
      );
      if (gone || !value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  async request(method, path, body, headers = {}) {
    const response = await fetch(this.url + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(this.cookies.size ? { cookie: this.cookieHeader } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.remember(response);
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON.
    }
    return { status: response.status, body: json, text, headers: response.headers };
  }
  get = (path, headers) => this.request('GET', path, undefined, headers);
  post = (path, body = {}, headers) => this.request('POST', path, body, headers);
  put = (path, body = {}, headers) => this.request('PUT', path, body, headers);
  delete = (path, headers) => this.request('DELETE', path, undefined, headers);
  signIn = (username, password) => this.post('/api/auth/sign-in', { username, password });
}

// Google Drive stand-ins that refuse every request like a credential without
// the Drive scope (403), so no test can reach Google.
export const driveDenied = () =>
  Object.assign(new Error('Synthetic Drive refusal'), { response: { status: 403 } });
const refuseDoc = async () => {
  throw driveDenied();
};
const refuseFolder = async () => {
  throw driveDenied();
};

// Starts the app with accounts on. mode is the AI_MODE; `accounts: false`
// starts it without the accounts service (DATABASE_URL unset). `autofill`, when
// given, is passed to createProfileAutofill (model, fetchImpl, timeoutMs, ...)
// with its log lines kept in `logs`; without it the app builds its default
// autofill service, whose Vertex AI requests fail. The company search is the
// synthetic handbook (`companyRetrieve`); `loadGoogleDocument(id)` and
// `loadDriveKnowledge(folderId)` stand in for Google Drive (both refuse by default).
export async function startAccountsApp({
  mode = 'document-search',
  env: extraEnv = {},
  accounts: enabled = true,
  storageTimeoutMs = 300,
  autofill = undefined,
  companyRetrieve = fakeRetrieve,
  loadGoogleDocument = refuseDoc,
  loadDriveKnowledge = refuseFolder,
} = {}) {
  const database = await createTestDatabase();
  const firestore = new FakeFirestore();
  const clock = testClock();
  const hashing = countingHashing();
  const logs = [];
  const log = (line) => logs.push(line);
  const store = createAccountStore({ pool: database.pool, log });
  const profiles = createProfileStore({ firestore, log, timeoutMs: storageTimeoutMs });
  const accounts = createAccountService({ store, profiles, now: clock.now, hashing, log });
  const env = { AI_MODE: mode, ...(enabled ? accountEnv : {}), ...extraEnv };
  const memory = createFirestoreChatMemory({ firestore, log, sweepIntervalMs: Infinity });
  const companyDocuments = createCompanyDocumentStore({
    firestore,
    log,
    timeoutMs: storageTimeoutMs,
  });
  // The app passes in its retriever, which adds the company library for
  // account-owned chats.
  const conversationService = ({ retrieve }) =>
    createConversationService({ env, memory, models: fakeModels(), retrieve });
  const getAccessToken = async () => 'synthetic-token';
  const fetchImpl = async () => {
    throw new Error('No Google request is expected in account tests.');
  };
  const app = createApp({
    env,
    accountService: enabled ? accounts : null,
    conversationService,
    companyDocuments,
    companyRetrieve,
    loadGoogleDocument,
    loadDriveKnowledge,
    getAccessToken,
    fetchImpl,
    ...(autofill
      ? {
          profileAutofill: createProfileAutofill({
            env,
            log,
            getAccessToken,
            fetchImpl,
            ...autofill,
          }),
        }
      : {}),
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  // An HR account made the way `npm run hr:create` makes it.
  async function createHr(username = 'HR-0001', password = 'synthetic-hr-pass-1') {
    return store.createAccount({
      username,
      passwordHash: await hashing.hash(password),
      role: 'hr',
      mustChangePassword: false,
      action: 'hr_account_created',
      at: clock.now(),
    });
  }
  return {
    url,
    env,
    database,
    firestore,
    clock,
    hashing,
    logs,
    store,
    accounts,
    browser: () => new Browser(url),
    createHr,
    // An HR browser that is signed in, and a helper creating employees with it.
    async hrBrowser(username = 'HR-0001', password = 'synthetic-hr-pass-1') {
      await createHr(username, password);
      const hr = new Browser(url);
      const signed = await hr.signIn(username, password);
      if (signed.status !== 200) throw new Error('HR sign-in failed in test set-up');
      return hr;
    },
    async createEmployee(hr, username = 'EMP-0001', temporaryPassword = 'temporary-pass-1') {
      const created = await hr.post('/api/hr/employees', {
        username,
        temporaryPassword,
        profile: syntheticProfile(),
      });
      if (created.status !== 201) throw new Error(`Employee creation failed: ${created.text}`);
      return created.body.employee;
    },
    // An employee who has signed in and replaced the temporary password.
    async readyEmployee(hr, username = 'EMP-0001', password = 'employee-own-pass-1') {
      const employee = await this.createEmployee(hr, username);
      const browser = new Browser(url);
      await browser.signIn(username, 'temporary-pass-1');
      const changed = await browser.post('/api/auth/password', {
        currentPassword: 'temporary-pass-1',
        newPassword: password,
      });
      if (changed.status !== 200) throw new Error(`Password change failed: ${changed.text}`);
      return { employee, browser };
    },
    rows: database.rows,
    memory,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await memory.close();
    },
  };
}
