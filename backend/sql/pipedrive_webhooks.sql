-- Tabla para almacenar peticiones entrantes del webhook de Pipedrive
CREATE TABLE IF NOT EXISTS pipedrive_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_uuid uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pipedrive_webhooks_received_at ON pipedrive_webhooks (received_at DESC);
