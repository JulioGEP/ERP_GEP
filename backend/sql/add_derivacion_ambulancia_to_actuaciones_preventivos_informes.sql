ALTER TABLE actuaciones_preventivos_informes
  ADD COLUMN IF NOT EXISTS derivacion_ambulancia INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'actuaciones_preventivos_informes_derivacion_ambulancia_check'
  ) THEN
    ALTER TABLE actuaciones_preventivos_informes
      ADD CONSTRAINT actuaciones_preventivos_informes_derivacion_ambulancia_check
      CHECK (derivacion_ambulancia IS NULL OR derivacion_ambulancia >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'actuaciones_preventivos_informes_derivaciones_requires_asistencias_check'
  ) THEN
    ALTER TABLE actuaciones_preventivos_informes
      ADD CONSTRAINT actuaciones_preventivos_informes_derivaciones_requires_asistencias_check
      CHECK (
        COALESCE(asistencias_sanitarias, 0) > 0
        OR (derivaron_mutua IS NULL AND derivacion_ambulancia IS NULL)
      );
  END IF;
END;
$$;
