CREATE TABLE IF NOT EXISTS office_payrolls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  categoria varchar(255),
  salario_bruto numeric(12,2),
  aportacion_ss_irpf numeric(12,2),
  salario_limpio numeric(12,2),
  created_at timestamptz(6) DEFAULT now(),
  updated_at timestamptz(6) DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_office_payrolls_period ON office_payrolls (user_id, year, month);
CREATE INDEX IF NOT EXISTS idx_office_payrolls_period ON office_payrolls (year, month);
