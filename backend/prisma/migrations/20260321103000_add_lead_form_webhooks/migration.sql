CREATE TABLE IF NOT EXISTS public.lead_form_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source varchar(120),
  event_name varchar(120),
  form_name varchar(255),
  entry_id varchar(120),
  lead_name varchar(255),
  lead_email varchar(320),
  lead_phone varchar(120),
  lead_message text,
  request_headers jsonb,
  payload_json jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_form_webhooks_created_at
  ON public.lead_form_webhooks (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_form_webhooks_source
  ON public.lead_form_webhooks (source);

CREATE INDEX IF NOT EXISTS idx_lead_form_webhooks_lead_email
  ON public.lead_form_webhooks (lead_email);
