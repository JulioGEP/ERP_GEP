-- Remove legacy profile fields from users
ALTER TABLE "users"
  DROP COLUMN IF EXISTS "position",
  DROP COLUMN IF EXISTS "start_date";
