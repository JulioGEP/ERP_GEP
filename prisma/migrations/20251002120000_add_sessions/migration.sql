CREATE TABLE "sesiones" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "deal_id" TEXT NOT NULL,
  "deal_product_id" TEXT NOT NULL,
  "nombre_cache" TEXT NOT NULL,
  "fecha_inicio_utc" TIMESTAMPTZ,
  "fecha_fin_utc" TIMESTAMPTZ,
  "sala_id" TEXT,
  "direccion" TEXT NOT NULL DEFAULT ''::text,
  "comentarios" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "sesiones_deal_fk" FOREIGN KEY ("deal_id") REFERENCES "deals"("deal_id") ON DELETE CASCADE,
  CONSTRAINT "sesiones_deal_product_fk" FOREIGN KEY ("deal_product_id") REFERENCES "deal_products"("id") ON DELETE CASCADE,
  CONSTRAINT "sesiones_sala_fk" FOREIGN KEY ("sala_id") REFERENCES "salas"("id")
);

CREATE INDEX "idx_sesiones_deal_id" ON "sesiones" ("deal_id");
CREATE INDEX "idx_sesiones_deal_product_id" ON "sesiones" ("deal_product_id");
CREATE INDEX "idx_sesiones_sala_id" ON "sesiones" ("sala_id");

CREATE TABLE "sesion_trainers" (
  "sesion_id" TEXT NOT NULL,
  "trainer_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "sesion_trainers_pk" PRIMARY KEY ("sesion_id", "trainer_id"),
  CONSTRAINT "sesion_trainers_session_fk" FOREIGN KEY ("sesion_id") REFERENCES "sesiones"("id") ON DELETE CASCADE,
  CONSTRAINT "sesion_trainers_trainer_fk" FOREIGN KEY ("trainer_id") REFERENCES "trainers"("trainer_id") ON DELETE CASCADE
);

CREATE INDEX "idx_sesion_trainers_trainer_id" ON "sesion_trainers" ("trainer_id");

CREATE TABLE "sesion_unidades" (
  "sesion_id" TEXT NOT NULL,
  "unidad_mov_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "sesion_unidades_pk" PRIMARY KEY ("sesion_id", "unidad_mov_id"),
  CONSTRAINT "sesion_unidades_session_fk" FOREIGN KEY ("sesion_id") REFERENCES "sesiones"("id") ON DELETE CASCADE,
  CONSTRAINT "sesion_unidades_unidad_fk" FOREIGN KEY ("unidad_mov_id") REFERENCES "unidades_moviles"("unidad_id") ON DELETE CASCADE
);

CREATE INDEX "idx_sesion_unidades_unidad_mov_id" ON "sesion_unidades" ("unidad_mov_id");
