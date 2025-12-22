ALTER TABLE "user_payrolls"
ADD COLUMN IF NOT EXISTS "aportacion_ss_irpf_detalle" TEXT,
ADD COLUMN IF NOT EXISTS "contingencias_comunes_detalle" TEXT;
