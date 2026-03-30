ALTER TABLE actuaciones_preventivos_informes
  ADD COLUMN IF NOT EXISTS derivaron_mutua INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'actuaciones_preventivos_informes_derivaron_mutua_check'
  ) THEN
    ALTER TABLE actuaciones_preventivos_informes
      ADD CONSTRAINT actuaciones_preventivos_informes_derivaron_mutua_check
      CHECK (derivaron_mutua IS NULL OR derivaron_mutua >= 0);
  END IF;
END;
$$;
