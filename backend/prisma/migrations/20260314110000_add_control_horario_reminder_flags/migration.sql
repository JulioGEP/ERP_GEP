ALTER TABLE "user_time_logs"
  ADD COLUMN "reminder_8h30_sent_at" TIMESTAMPTZ(6),
  ADD COLUMN "reminder_12h30_sent_at" TIMESTAMPTZ(6);
