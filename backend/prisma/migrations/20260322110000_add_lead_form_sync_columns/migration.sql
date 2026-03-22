ALTER TABLE public.lead_form_webhooks
  ADD COLUMN IF NOT EXISTS pipedrive_organization_id varchar(80),
  ADD COLUMN IF NOT EXISTS pipedrive_person_id varchar(80),
  ADD COLUMN IF NOT EXISTS pipedrive_lead_id varchar(80),
  ADD COLUMN IF NOT EXISTS pipedrive_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS slack_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_error text;
