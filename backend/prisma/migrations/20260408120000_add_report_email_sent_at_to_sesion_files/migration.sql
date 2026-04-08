ALTER TABLE "sesion_files"
ADD COLUMN IF NOT EXISTS "report_email_sent_at" timestamptz(6);

CREATE INDEX IF NOT EXISTS "idx_sesion_files_report_email_sent_at"
ON "sesion_files" ("report_email_sent_at");
