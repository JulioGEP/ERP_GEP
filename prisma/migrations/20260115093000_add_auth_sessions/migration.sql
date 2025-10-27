-- Create table for authentication sessions
CREATE TABLE IF NOT EXISTS auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    ip_address TEXT,
    user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

-- Columns for password reset flow
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reset_token TEXT,
  ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reset_requested_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_reset_token
  ON users(reset_token)
  WHERE reset_token IS NOT NULL;

-- Ensure updated_at reflects changes automatically on auth_sessions
CREATE OR REPLACE FUNCTION touch_auth_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auth_sessions_updated_at ON auth_sessions;
CREATE TRIGGER trg_auth_sessions_updated_at
BEFORE UPDATE ON auth_sessions
FOR EACH ROW
EXECUTE FUNCTION touch_auth_sessions_updated_at();
