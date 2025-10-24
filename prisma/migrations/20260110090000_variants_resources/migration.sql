ALTER TABLE "variants"
  ADD COLUMN IF NOT EXISTS "trainer_id" TEXT,
  ADD COLUMN IF NOT EXISTS "sala_id" TEXT,
  ADD COLUMN IF NOT EXISTS "unidad_movil_id" TEXT;

CREATE INDEX IF NOT EXISTS "idx_variants_trainer_id" ON "variants" ("trainer_id");
CREATE INDEX IF NOT EXISTS "idx_variants_sala_id" ON "variants" ("sala_id");
CREATE INDEX IF NOT EXISTS "idx_variants_unidad_movil_id" ON "variants" ("unidad_movil_id");

ALTER TABLE "variants"
  ADD CONSTRAINT "variants_trainer_fk"
    FOREIGN KEY ("trainer_id") REFERENCES "trainers"("trainer_id") ON DELETE SET NULL;

ALTER TABLE "variants"
  ADD CONSTRAINT "variants_sala_fk"
    FOREIGN KEY ("sala_id") REFERENCES "salas"("id") ON DELETE SET NULL;

ALTER TABLE "variants"
  ADD CONSTRAINT "variants_unidad_fk"
    FOREIGN KEY ("unidad_movil_id") REFERENCES "unidades_moviles"("unidad_id") ON DELETE SET NULL;
