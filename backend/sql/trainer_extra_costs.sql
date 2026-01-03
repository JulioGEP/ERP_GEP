-- backend/sql/trainer_extra_costs.sql
-- Tabla para almacenar los costes adicionales asignados a cada formador por sesión o variante.
CREATE TABLE IF NOT EXISTS trainer_extra_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id TEXT NOT NULL,
  session_id UUID NULL,
  variant_id UUID NULL,
  payroll_year INTEGER NULL,
  payroll_month INTEGER NULL,
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
    CHECK (
      ((session_id IS NOT NULL)::int + (variant_id IS NOT NULL)::int + ((payroll_year IS NOT NULL AND payroll_month IS NOT NULL)::int)) = 1
    ),
  CONSTRAINT trainer_extra_costs_ck_payroll_period
    CHECK ((payroll_year IS NULL) = (payroll_month IS NULL)),
  CONSTRAINT trainer_extra_costs_trainer_fk
    FOREIGN KEY (trainer_id) REFERENCES trainers(trainer_id) ON DELETE CASCADE,
  CONSTRAINT trainer_extra_costs_session_fk
    FOREIGN KEY (session_id) REFERENCES sesiones(id) ON DELETE CASCADE,
  CONSTRAINT trainer_extra_costs_variant_fk
    FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE,
  CONSTRAINT trainer_extra_costs_session_key UNIQUE (trainer_id, session_id),
  CONSTRAINT trainer_extra_costs_variant_key UNIQUE (trainer_id, variant_id),
  CONSTRAINT trainer_extra_costs_payroll_key UNIQUE (trainer_id, payroll_year, payroll_month)
);

CREATE INDEX IF NOT EXISTS idx_trainer_extra_costs_trainer_id
  ON trainer_extra_costs (trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_extra_costs_session_id
  ON trainer_extra_costs (session_id);
CREATE INDEX IF NOT EXISTS idx_trainer_extra_costs_variant_id
  ON trainer_extra_costs (variant_id);
CREATE INDEX IF NOT EXISTS idx_trainer_extra_costs_payroll_period
  ON trainer_extra_costs (payroll_year, payroll_month);

CREATE OR REPLACE FUNCTION sync_trainer_extra_costs_to_office_payrolls()
RETURNS TRIGGER AS
$$
DECLARE
  v_origin TEXT := current_setting('app.sync_origin', true);
  v_year INTEGER;
  v_month INTEGER;
  v_user_id UUID;
BEGIN
  IF v_origin = 'office_payrolls' THEN
    RETURN NEW;
  END IF;

  SELECT user_id::UUID INTO v_user_id
  FROM trainers
  WHERE trainer_id = NEW.trainer_id
    AND user_id IS NOT NULL
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.payroll_year IS NOT NULL AND NEW.payroll_month IS NOT NULL THEN
    v_year := NEW.payroll_year;
    v_month := NEW.payroll_month;
  ELSIF NEW.session_id IS NOT NULL THEN
    SELECT EXTRACT(YEAR FROM fecha_inicio_utc)::INT, EXTRACT(MONTH FROM fecha_inicio_utc)::INT
    INTO v_year, v_month
    FROM sesiones
    WHERE id = NEW.session_id;
  ELSIF NEW.variant_id IS NOT NULL THEN
    SELECT EXTRACT(YEAR FROM date)::INT, EXTRACT(MONTH FROM date)::INT
    INTO v_year, v_month
    FROM variants
    WHERE id = NEW.variant_id;
  END IF;

  IF v_year IS NULL OR v_month IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.sync_origin', 'trainer_extra_costs', true);

  INSERT INTO office_payrolls (user_id, year, month, dietas, kilometrajes, pernocta, nocturnidad, horas_extras, otros_gastos, total_extras, updated_at)
  VALUES (
    v_user_id,
    v_year,
    v_month,
    NEW.dietas,
    NEW.kilometraje,
    NEW.pernocta,
    NEW.nocturnidad,
    NEW.horas_extras,
    NEW.gastos_extras,
    COALESCE(NEW.dietas, 0) + COALESCE(NEW.kilometraje, 0) + COALESCE(NEW.pernocta, 0) + COALESCE(NEW.nocturnidad, 0) + COALESCE(NEW.festivo, 0) + COALESCE(NEW.horas_extras, 0) + COALESCE(NEW.gastos_extras, 0),
    now()
  )
  ON CONFLICT (user_id, year, month) DO UPDATE
    SET dietas = EXCLUDED.dietas,
        kilometrajes = EXCLUDED.kilometrajes,
        pernocta = EXCLUDED.pernocta,
        nocturnidad = EXCLUDED.nocturnidad,
        horas_extras = EXCLUDED.horas_extras,
        otros_gastos = EXCLUDED.otros_gastos,
        total_extras = EXCLUDED.total_extras,
        updated_at = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_trainer_extra_costs ON trainer_extra_costs;
CREATE TRIGGER trg_sync_trainer_extra_costs
AFTER INSERT OR UPDATE ON trainer_extra_costs
FOR EACH ROW
EXECUTE FUNCTION sync_trainer_extra_costs_to_office_payrolls();
