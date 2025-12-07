CREATE TABLE IF NOT EXISTS variant_comments (
  id BIGSERIAL PRIMARY KEY,
  variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  author VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_variant_comments_variant_id ON variant_comments(variant_id);
