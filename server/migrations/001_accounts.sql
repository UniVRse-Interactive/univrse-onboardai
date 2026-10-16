-- HR and employee accounts (issue #23). PostgreSQL holds sign-in data only:
-- usernames, password hashes, roles, status, sessions and an audit trail.
-- Personal profiles and chats live in Firestore. Applied by `npm run db:migrate`.

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Employee ID / HR ID from the login page. Unique regardless of letter case.
  username text NOT NULL CHECK (username ~ '^[A-Za-z0-9._-]{3,32}$'),
  -- scrypt$n=<N>,r=<r>,p=<p>$<salt>$<key> (see server/password-hashing.mjs).
  password_hash text NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
  role text NOT NULL CHECK (role IN ('hr', 'employee')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  must_change_password boolean NOT NULL DEFAULT false,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_sign_in_at timestamptz,
  created_by uuid REFERENCES accounts (id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX accounts_username_lower_key ON accounts (lower(username));
CREATE INDEX accounts_role ON accounts (role);

-- Only the SHA-256 of each session token is stored; the token itself lives in
-- the browser's HttpOnly cookie.
CREATE TABLE sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_account_id ON sessions (account_id);
CREATE INDEX sessions_expires_at ON sessions (expires_at);

-- Who did what to which account, and when. Never secrets or profile values.
CREATE TABLE account_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES accounts (id) ON DELETE SET NULL,
  target_id uuid REFERENCES accounts (id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action ~ '^[a-z_]{3,40}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_events_target ON account_events (target_id, created_at);
