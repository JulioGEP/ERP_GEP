-- backend/sql/trainer_extra_costs.sql
-- Tabla para almacenar los costes adicionales asignados a cada formador por sesión o variante.
CREATE TABLE IF NOT EXISTS trainer_extra_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id TEXT NOT NULL,
  session_id UUID NULL,
  variant_id UUID NULL,
  precio_coste_formacion NUMERIC(12, 2) NOT NULL DEFAULT 0,
  precio_coste_preventivo NUMERIC(12, 2) NOT NULL DEFAULT 0,
  dietas NUMERIC(12, 2) NOT NULL DEFAULT 0,
  kilometraje NUMERIC(12, 2) NOT NULL DEFAULT 0,
  pernocta NUMERIC(12, 2) NOT NULL DEFAULT 0,
  nocturnidad NUMERIC(12, 2) NOT NULL DEFAULT 0,
  festivo NUMERIC(12, 2) NOT NULL DEFAULT 0,
  horas_extras NUMERIC(12, 2) NOT NULL DEFAULT 0,
  gastos_extras NUMERIC(12, 2) NOT NULL DEFAULT 0,
  notas TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trainer_extra_costs_ck_assignment
    CHECK (((session_id IS NOT NULL)::int + (variant_id IS NOT NULL)::int) = 1),
  CONSTRAINT trainer_extra_costs_trainer_fk
    FOREIGN KEY (trainer_id) REFERENCES trainers(trainer_id) ON DELETE CASCADE,
  CONSTRAINT trainer_extra_costs_session_fk
    FOREIGN KEY (session_id) REFERENCES sesiones(id) ON DELETE CASCADE,
  CONSTRAINT trainer_extra_costs_variant_fk
    FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE,
  CONSTRAINT trainer_extra_costs_session_key UNIQUE (trainer_id, session_id),
  CONSTRAINT trainer_extra_costs_variant_key UNIQUE (trainer_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_trainer_extra_costs_trainer_id
  ON trainer_extra_costs (trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_extra_costs_session_id
  ON trainer_extra_costs (session_id);
CREATE INDEX IF NOT EXISTS idx_trainer_extra_costs_variant_id
  ON trainer_extra_costs (variant_id);
