-- Drop legacy links table if it still exists
DROP TABLE IF EXISTS "session_public_links";

-- Ensure the tokens table exists with the expected structure
CREATE TABLE IF NOT EXISTS "tokens" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL REFERENCES "sesiones"("id") ON DELETE CASCADE,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "expires_at" TIMESTAMPTZ,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,
    "ip_created" TEXT,
    "user_agent" TEXT
);

-- Enforce token uniqueness and add lookup indexes
CREATE UNIQUE INDEX IF NOT EXISTS "tokens_token_key" ON "tokens"("token");
CREATE INDEX IF NOT EXISTS "tokens_session_id_idx" ON "tokens"("session_id");
