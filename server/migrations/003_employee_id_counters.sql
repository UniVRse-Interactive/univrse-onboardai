-- Employee IDs assigned by the server (issue #34): PE-0001, CS-0001, ... counted
-- per department prefix (server/departments.mjs). One row per prefix holds the
-- last number handed out. The first creation for a prefix adds its row, starting
-- after the highest existing username with that prefix; every creation takes the
-- next number inside its own transaction (server/account-store.mjs). Numbers only
-- go up: a deleted employee or a failed creation never gives its number back.
-- Safe to run again.

CREATE TABLE IF NOT EXISTS employee_id_counters (
  prefix text PRIMARY KEY CHECK (prefix ~ '^[A-Z]{2}$'),
  last_number integer NOT NULL CHECK (last_number >= 1)
);
