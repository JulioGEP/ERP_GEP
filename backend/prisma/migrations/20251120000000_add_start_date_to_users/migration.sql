-- Ensure the users.start_date column exists for Prisma queries
ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "start_date" DATE;
