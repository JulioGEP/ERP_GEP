CREATE TABLE IF NOT EXISTS office_payrolls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  dietas numeric(12,2),
  kilometrajes numeric(12,2),
  pernocta numeric(12,2),
  nocturnidad numeric(12,2),
  festivo numeric(12,2),
  horas_extras numeric(12,2),
  otros_gastos numeric(12,2),
  total_extras numeric(12,2),
  convenio varchar(255),
  categoria varchar(255),
  antiguedad date,
  horas_semana numeric(6,2),
  base_retencion numeric(12,2),
  base_retencion_detalle text,
  salario_bruto numeric(12,2),
  salario_bruto_total numeric(12,2),
  retencion numeric(12,2),
  aportacion_ss_irpf numeric(12,2),
  aportacion_ss_irpf_detalle text,
  salario_limpio numeric(12,2),
  contingencias_comunes numeric(12,2),
  contingencias_comunes_detalle text,
  total_empresa numeric(12,2),
  created_at timestamptz(6) DEFAULT now(),
  updated_at timestamptz(6) DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_office_payrolls_period ON office_payrolls (user_id, year, month);
CREATE INDEX IF NOT EXISTS idx_office_payrolls_period ON office_payrolls (year, month);

CREATE OR REPLACE FUNCTION sync_office_payrolls_to_trainer_extra_costs()
RETURNS TRIGGER AS
$$
DECLARE
  v_origin TEXT := current_setting('app.sync_origin', true);
  v_trainer_id TEXT;
BEGIN
  IF v_origin = 'trainer_extra_costs' THEN
    RETURN NEW;
  END IF;

  SELECT trainer_id INTO v_trainer_id
  FROM trainers
  WHERE user_id = NEW.user_id
  LIMIT 1;

  IF v_trainer_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.sync_origin', 'office_payrolls', true);

  INSERT INTO trainer_extra_costs (
    trainer_id,
    payroll_year,
    payroll_month,
    session_id,
    variant_id,
    dietas,
    kilometraje,
    pernocta,
    nocturnidad,
    horas_extras,
    gastos_extras,
    festivo,
    updated_at
  )
  VALUES (
    v_trainer_id,
    NEW.year,
    NEW.month,
    NULL,
    NULL,
    COALESCE(NEW.dietas, 0),
    COALESCE(NEW.kilometrajes, 0),
    COALESCE(NEW.pernocta, 0),
    COALESCE(NEW.nocturnidad, 0),
    COALESCE(NEW.horas_extras, 0),
    COALESCE(NEW.otros_gastos, 0),
    COALESCE(NEW.festivo, 0),
    now()
  )
  ON CONFLICT (trainer_id, payroll_year, payroll_month) DO UPDATE
    SET dietas = EXCLUDED.dietas,
        kilometraje = EXCLUDED.kilometraje,
        pernocta = EXCLUDED.pernocta,
        nocturnidad = EXCLUDED.nocturnidad,
        horas_extras = EXCLUDED.horas_extras,
        gastos_extras = EXCLUDED.gastos_extras,
        festivo = EXCLUDED.festivo,
        payroll_year = EXCLUDED.payroll_year,
        payroll_month = EXCLUDED.payroll_month,
        session_id = NULL,
        variant_id = NULL,
        updated_at = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_office_payrolls ON office_payrolls;
CREATE TRIGGER trg_sync_office_payrolls
AFTER INSERT OR UPDATE ON office_payrolls
FOR EACH ROW
EXECUTE FUNCTION sync_office_payrolls_to_trainer_extra_costs();
