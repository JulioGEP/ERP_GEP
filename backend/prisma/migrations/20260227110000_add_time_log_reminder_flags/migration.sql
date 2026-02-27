ALTER TABLE "user_time_logs"
  ADD COLUMN IF NOT EXISTS "reminder_8h_sent_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "reminder_12h_sent_at" TIMESTAMPTZ(6);
