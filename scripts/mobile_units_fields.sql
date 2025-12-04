-- Agrega campos de control y mantenimiento para unidades móviles
ALTER TABLE public.unidades_moviles
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS itv date,
  ADD COLUMN IF NOT EXISTS revision date,
  ADD COLUMN IF NOT EXISTS tipo_seguro text CHECK (tipo_seguro IN ('Anual', 'Trimestral')),
  ADD COLUMN IF NOT EXISTS vigencia_seguro date;
