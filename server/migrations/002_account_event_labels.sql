-- Deleting an employee account (issue #32). account_events.target_id becomes
-- NULL when its account is deleted (ON DELETE SET NULL), so the audit trail keeps
-- the deleted account's username (its Employee ID, never profile values) in
-- target_label. Safe to run again.

ALTER TABLE account_events ADD COLUMN IF NOT EXISTS target_label text;
ALTER TABLE account_events DROP CONSTRAINT IF EXISTS account_events_target_label_check;
ALTER TABLE account_events ADD CONSTRAINT account_events_target_label_check
  CHECK (target_label IS NULL OR target_label ~ '^[A-Za-z0-9._-]{3,32}$');
