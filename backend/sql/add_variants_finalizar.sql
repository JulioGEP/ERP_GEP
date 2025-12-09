-- Agrega el campo "finalizar" a la tabla de variantes y rellena los valores existentes.
ALTER TABLE public.variants
  ADD COLUMN IF NOT EXISTS finalizar VARCHAR(20) NOT NULL DEFAULT 'Activa';

-- Marca las variantes pasadas como "Finalizada" y deja el resto en "Activa".
UPDATE public.variants
SET finalizar = CASE
  WHEN "date" < CURRENT_DATE THEN 'Finalizada'
  ELSE 'Activa'
END;
