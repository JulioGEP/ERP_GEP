CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "password_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "password_algo" TEXT NOT NULL DEFAULT 'bcrypt',
  ADD COLUMN IF NOT EXISTS "password_updated_at" TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS "user_sessions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" TEXT NOT NULL UNIQUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expires_at" TIMESTAMPTZ NOT NULL,
  "revoked_at" TIMESTAMPTZ,
  "last_seen_at" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "idx_user_sessions_user_id" ON "user_sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_user_sessions_expires_at" ON "user_sessions" ("expires_at");

UPDATE "users"
SET
  "password_hash" = crypt('123456', gen_salt('bf')),
  "password_algo" = 'bcrypt',
  "password_updated_at" = now()
WHERE lower("email") = 'julio@gepgroup.es';
