CREATE TABLE IF NOT EXISTS trainer_confirmation_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sesion_id uuid,
  variant_id uuid,
  trainer_id text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','MAIL_SENT','CONFIRMED','DECLINED')),
  mail_sent_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Campos que usaremos en la tarea 2, ya los dejamos listos
  confirmation_token text,
  token_expires_at timestamptz
);

-- FKs (ajusta nombres de tablas/PKs si difieren)
ALTER TABLE trainer_confirmation_status
  ADD CONSTRAINT IF NOT EXISTS trainer_conf_session_fk
  FOREIGN KEY (sesion_id) REFERENCES sesiones(id) ON DELETE CASCADE;

ALTER TABLE trainer_confirmation_status
  ADD CONSTRAINT IF NOT EXISTS trainer_conf_variant_fk
  FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE;

ALTER TABLE trainer_confirmation_status
  ADD CONSTRAINT IF NOT EXISTS trainer_conf_trainer_fk
  FOREIGN KEY (trainer_id) REFERENCES trainers(trainer_id) ON DELETE CASCADE;

-- Índices
CREATE INDEX IF NOT EXISTS idx_trainer_conf_trainer ON trainer_confirmation_status (trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_conf_session ON trainer_confirmation_status (sesion_id);
CREATE INDEX IF NOT EXISTS idx_trainer_conf_variant ON trainer_confirmation_status (variant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trainer_conf_session_trainer
  ON trainer_confirmation_status (sesion_id, trainer_id) WHERE sesion_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_trainer_conf_variant_trainer
  ON trainer_confirmation_status (variant_id, trainer_id) WHERE variant_id IS NOT NULL;
