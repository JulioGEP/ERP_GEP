-- Add payroll and contract fields to trainers
ALTER TABLE "trainers"
  ADD COLUMN "nomina" DECIMAL(12,2),
  ADD COLUMN "contrato_fijo" BOOLEAN NOT NULL DEFAULT FALSE;
