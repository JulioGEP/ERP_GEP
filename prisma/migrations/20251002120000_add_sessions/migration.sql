CREATE TABLE "sessions" (
  "id" TEXT PRIMARY KEY,
  "deal_id" TEXT NOT NULL,
  "deal_product_id" TEXT NOT NULL,
  "nombre_cache" TEXT NOT NULL,
  "fecha_inicio_utc" TIMESTAMPTZ,
  "fecha_fin_utc" TIMESTAMPTZ,
  "sala_id" TEXT,
  "direccion" TEXT NOT NULL,
  "comentarios" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "sessions_deal_fk" FOREIGN KEY ("deal_id") REFERENCES "deals"("deal_id") ON DELETE CASCADE,
  CONSTRAINT "sessions_deal_product_fk" FOREIGN KEY ("deal_product_id") REFERENCES "deal_products"("id") ON DELETE CASCADE,
  CONSTRAINT "sessions_sala_fk" FOREIGN KEY ("sala_id") REFERENCES "salas"("id")
);

CREATE INDEX "idx_sessions_deal_id" ON "sessions" ("deal_id");
CREATE INDEX "idx_sessions_deal_product_id" ON "sessions" ("deal_product_id");
CREATE INDEX "idx_sessions_sala_id" ON "sessions" ("sala_id");

CREATE TABLE "session_trainers" (
  "session_id" TEXT NOT NULL,
  "trainer_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "session_trainers_pk" PRIMARY KEY ("session_id", "trainer_id"),
  CONSTRAINT "session_trainers_session_fk" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE,
  CONSTRAINT "session_trainers_trainer_fk" FOREIGN KEY ("trainer_id") REFERENCES "trainers"("trainer_id") ON DELETE CASCADE
);

CREATE INDEX "idx_session_trainers_trainer_id" ON "session_trainers" ("trainer_id");

CREATE TABLE "session_unidades" (
  "session_id" TEXT NOT NULL,
  "unidad_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "session_unidades_pk" PRIMARY KEY ("session_id", "unidad_id"),
  CONSTRAINT "session_unidades_session_fk" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE,
  CONSTRAINT "session_unidades_unidad_fk" FOREIGN KEY ("unidad_id") REFERENCES "unidades_moviles"("unidad_id") ON DELETE CASCADE
);

CREATE INDEX "idx_session_unidades_unidad_id" ON "session_unidades" ("unidad_id");
