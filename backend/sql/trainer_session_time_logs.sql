-- backend/sql/trainer_session_time_logs.sql
-- Tabla para almacenar los registros horarios de cada formador por sesión o variante.
CREATE TABLE IF NOT EXISTS trainer_session_time_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id TEXT NOT NULL,
  session_id UUID NULL,
  variant_id UUID NULL,
  scheduled_start_utc TIMESTAMPTZ NULL,
  scheduled_end_utc TIMESTAMPTZ NULL,
  check_in_utc TIMESTAMPTZ NOT NULL,
  check_out_utc TIMESTAMPTZ NOT NULL,
  recorded_by_user_id UUID NULL,
  recorded_by_name TEXT NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'trainer_portal',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trainer_session_time_logs_ck_assignment
    CHECK (session_id IS NOT NULL OR variant_id IS NOT NULL),
  CONSTRAINT trainer_session_time_logs_trainer_fk
    FOREIGN KEY (trainer_id) REFERENCES trainers(trainer_id) ON DELETE CASCADE,
  CONSTRAINT trainer_session_time_logs_session_fk
    FOREIGN KEY (session_id) REFERENCES sesiones(id) ON DELETE CASCADE,
  CONSTRAINT trainer_session_time_logs_variant_fk
    FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE,
  CONSTRAINT trainer_session_time_logs_session_unique UNIQUE (trainer_id, session_id),
  CONSTRAINT trainer_session_time_logs_variant_unique UNIQUE (trainer_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_trainer_session_time_logs_trainer_id
  ON trainer_session_time_logs (trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_session_time_logs_session_id
  ON trainer_session_time_logs (session_id);
CREATE INDEX IF NOT EXISTS idx_trainer_session_time_logs_variant_id
  ON trainer_session_time_logs (variant_id);
