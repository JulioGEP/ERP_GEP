-- SQL para crear la tabla trainer_variant_invites
CREATE TABLE IF NOT EXISTS trainer_variant_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL,
  trainer_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  created_by_user_id UUID,
  created_by_email TEXT,
  created_by_name TEXT,
  trainer_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_trainer_variant_invites_variant
    FOREIGN KEY (variant_id)
    REFERENCES variants(id)
    ON DELETE CASCADE
    ON UPDATE NO ACTION,
  CONSTRAINT fk_trainer_variant_invites_trainer
    FOREIGN KEY (trainer_id)
    REFERENCES trainers(trainer_id)
    ON DELETE CASCADE
    ON UPDATE NO ACTION,
  CONSTRAINT ck_trainer_variant_invites_status
    CHECK (status IN ('PENDING', 'CONFIRMED', 'DECLINED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_trainer_variant_invites_variant_trainer
  ON trainer_variant_invites (variant_id, trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_variant_invites_variant_id
  ON trainer_variant_invites (variant_id);
CREATE INDEX IF NOT EXISTS idx_trainer_variant_invites_trainer_id
  ON trainer_variant_invites (trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_variant_invites_created_by
  ON trainer_variant_invites (created_by_user_id);
