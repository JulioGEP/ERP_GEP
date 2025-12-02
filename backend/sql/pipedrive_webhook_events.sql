-- backend/sql/pipedrive_webhook_events.sql
-- Tabla para almacenar los eventos recibidos desde el webhook de Pipedrive.
CREATE TABLE IF NOT EXISTS pipedrive_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  event VARCHAR(150),
  event_action VARCHAR(100),
  event_object VARCHAR(100),
  company_id INT,
  object_id INT,
  retry INT,
  webhook_token VARCHAR(255),
  headers JSONB,
  payload JSONB NOT NULL,
  CONSTRAINT pipedrive_webhook_events_payload_chk CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_pipedrive_webhook_events_created_at
  ON pipedrive_webhook_events (created_at);
