-- Departments HR can manage (issue #36). Each department has a name and the
-- Employee ID prefix (2 to 4 capital letters) its new employees get, e.g.
-- Finance -> FN-0001. Departments are archived, never deleted: an archived one
-- cannot be chosen for a new hire, but stays valid on existing profiles, and its
-- prefix stays reserved. The six first departments (server/departments.mjs) are
-- seeded here; HR changes them in Settings after that. Safe to run again.

CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (name ~ '^.{1,60}$'),
  -- HR is reserved for HR accounts (HR-0001).
  prefix text NOT NULL CHECK (prefix ~ '^[A-Z]{2,4}$' AND prefix <> 'HR'),
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS departments_name_lower_key ON departments (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS departments_prefix_key ON departments (prefix);

INSERT INTO departments (name, prefix) VALUES
  ('Product & Engineering', 'PE'),
  ('Customer Success', 'CS'),
  ('Sales & Marketing', 'SM'),
  ('Finance', 'FN'),
  ('People & Culture', 'PC'),
  ('Operations & Facilities', 'OF')
ON CONFLICT DO NOTHING;

-- Prefixes can be 2 to 4 letters now.
ALTER TABLE employee_id_counters DROP CONSTRAINT IF EXISTS employee_id_counters_prefix_check;
ALTER TABLE employee_id_counters ADD CONSTRAINT employee_id_counters_prefix_check
  CHECK (prefix ~ '^[A-Z]{2,4}$');

-- Department events (department_created, department_updated, department_archived,
-- department_restored) have no target account and no username, so what they
-- changed goes in detail: a JSON object with the department's id, name and
-- prefix and the old and new values. Never secrets or profile values.
ALTER TABLE account_events ADD COLUMN IF NOT EXISTS detail jsonb;
