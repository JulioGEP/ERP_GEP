-- AlterTable
ALTER TABLE "unidades_moviles"
ALTER COLUMN "tipo" TYPE TEXT[] USING CASE
  WHEN "tipo" IS NULL THEN ARRAY[]::TEXT[]
  ELSE ARRAY["tipo"]::TEXT[]
END,
ALTER COLUMN "tipo" SET DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "tipo" SET NOT NULL,
ALTER COLUMN "sede" TYPE TEXT[] USING CASE
  WHEN "sede" IS NULL THEN ARRAY[]::TEXT[]
  ELSE ARRAY["sede"]::TEXT[]
END,
ALTER COLUMN "sede" SET DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "sede" SET NOT NULL;

UPDATE "unidades_moviles"
SET "tipo" = COALESCE(
  (
    SELECT ARRAY_AGG(
      CASE
        WHEN LOWER(value) = 'formación' THEN 'Formación'
        WHEN LOWER(value) = 'preventivo' THEN 'Preventivo'
        WHEN LOWER(value) = 'pci' THEN 'PCI'
        WHEN LOWER(value) = 'remolque' THEN 'Remolque'
        ELSE value
      END
    )
    FROM UNNEST("tipo") AS value
  ),
  ARRAY[]::TEXT[]
);

UPDATE "unidades_moviles"
SET "sede" = COALESCE(
  (
    SELECT ARRAY_AGG(
      CASE
        WHEN LOWER(value) = 'gep arganda' THEN 'GEP Arganda'
        WHEN LOWER(value) = 'gep sabadell' THEN 'GEP Sabadell'
        WHEN LOWER(value) = 'in company' THEN 'In Company'
        ELSE value
      END
    )
    FROM UNNEST("sede") AS value
  ),
  ARRAY[]::TEXT[]
);
