import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// Password hashes use Node's built-in scrypt with a random 16-byte salt per
// password. The parameters travel with the hash, so they can be raised later
// without breaking stored passwords:
//
//   scrypt$n=32768,r=8,p=1$<salt, base64url>$<64-byte key, base64url>
//
// Plaintext passwords are never logged, returned or stored.
export const scryptDefaults = Object.freeze({ n: 32768, r: 8, p: 1, keyLength: 64 });
export const passwordLimits = Object.freeze({ min: 8, max: 200 });
const saltBytes = 16;
const hashPattern =
  /^scrypt\$n=(\d{1,8}),r=(\d{1,3}),p=(\d{1,3})\$([A-Za-z0-9_-]{22,})\$([A-Za-z0-9_-]{22,})$/;

function derive(password, salt, { n, r, p }, keyLength) {
  return new Promise((resolve, reject) =>
    scrypt(
      String(password).normalize('NFC'),
      salt,
      keyLength,
      // Room for the 128 * n * r bytes scrypt needs, plus headroom.
      { N: n, r, p, maxmem: 128 * n * r * p + 16 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}

export async function hashPassword(password, params = scryptDefaults) {
  const salt = randomBytes(saltBytes);
  const key = await derive(password, salt, params, params.keyLength);
  return `scrypt$n=${params.n},r=${params.r},p=${params.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

// Parses a stored hash and rejects parameters outside safe bounds, so a damaged
// row cannot make the server burn memory.
export function parsePasswordHash(stored) {
  const match = typeof stored === 'string' && hashPattern.exec(stored);
  if (!match) return null;
  const [n, r, p] = match.slice(1, 4).map(Number);
  const salt = Buffer.from(match[4], 'base64url'),
    key = Buffer.from(match[5], 'base64url');
  const powerOfTwo = n > 1 && (n & (n - 1)) === 0;
  if (!powerOfTwo || n > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16) return null;
  if (salt.length < saltBytes || key.length < 32 || key.length > 128) return null;
  return { n, r, p, salt, key };
}

export async function verifyPassword(password, stored) {
  const parsed = parsePasswordHash(stored);
  if (!parsed || typeof password !== 'string') return false;
  const key = await derive(password, parsed.salt, parsed, parsed.key.length);
  return timingSafeEqual(key, parsed.key);
}

// A hash of a random password, made once with the current parameters. Unknown
// usernames are checked against it so a failed sign-in costs the same time
// whether or not the account exists.
let dummy = null;
export function dummyPasswordHash(params = scryptDefaults) {
  dummy ||= hashPassword(randomBytes(24).toString('base64url'), params);
  return dummy;
}

const characters = (value) => [...value].length;

// Returns a message for the first rule the password breaks, or null.
export function passwordProblem(password, username = '') {
  if (typeof password !== 'string' || !password) return 'Enter a password.';
  const length = characters(password);
  if (length < passwordLimits.min)
    return `Use a password of at least ${passwordLimits.min} characters.`;
  if (length > passwordLimits.max)
    return `Use a password of at most ${passwordLimits.max} characters.`;
  if (typeof username === 'string' && password.toLowerCase() === username.toLowerCase())
    return 'The password cannot be the same as the ID.';
  return null;
}
