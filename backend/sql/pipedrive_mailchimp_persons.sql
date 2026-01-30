-- backend/sql/pipedrive_mailchimp_persons.sql
-- Tabla para almacenar personas de Pipedrive para Mailchimp.
CREATE TABLE IF NOT EXISTS pipedrive_mailchimp_persons (
  person_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  label_ids JSONB,
  org_id TEXT,
  org_address TEXT,
  size_employees TEXT,
  segment TEXT,
  employee_count INTEGER,
  annual_revenue NUMERIC(14, 2),
  formacion TEXT,
  servicio TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipedrive_mailchimp_persons_org_id
  ON pipedrive_mailchimp_persons (org_id);
