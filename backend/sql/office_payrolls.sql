CREATE TABLE IF NOT EXISTS office_payrolls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
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
