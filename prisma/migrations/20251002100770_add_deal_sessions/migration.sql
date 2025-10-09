-- Drop old seasons table if it exists
DROP TABLE IF EXISTS "seassons";

-- Create enum for session status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'deal_session_status') THEN
    CREATE TYPE "deal_session_status" AS ENUM ('Borrador', 'Planificada', 'Suspendido', 'Cancelado');
  END IF;
END$$;

-- Create main sessions table
CREATE TABLE IF NOT EXISTS "deal_sessions" (
  "session_id" TEXT PRIMARY KEY,
  "deal_id" TEXT NOT NULL,
  "deal_product_id" TEXT,
  "status" "deal_session_status" NOT NULL DEFAULT 'Borrador',
  "start_at" TIMESTAMPTZ(6),
  "end_at" TIMESTAMPTZ(6),
  "sala_id" TEXT,
  "direccion" TEXT,
  "sede" TEXT,
  "comentarios" TEXT,
  "origen" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_deal_sessions_deal_id" ON "deal_sessions" USING btree ("deal_id");
CREATE INDEX IF NOT EXISTS "idx_deal_sessions_deal_product_id" ON "deal_sessions" USING btree ("deal_product_id");
CREATE INDEX IF NOT EXISTS "idx_deal_sessions_sala_id" ON "deal_sessions" USING btree ("sala_id");

-- Create join table for trainers
CREATE TABLE IF NOT EXISTS "deal_session_trainers" (
  "session_id" TEXT NOT NULL,
  "trainer_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deal_session_trainers_pkey" PRIMARY KEY ("session_id", "trainer_id")
);

CREATE INDEX IF NOT EXISTS "idx_deal_session_trainers_trainer_id" ON "deal_session_trainers" USING btree ("trainer_id");

-- Create join table for mobile units
CREATE TABLE IF NOT EXISTS "deal_session_mobile_units" (
  "session_id" TEXT NOT NULL,
  "unidad_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deal_session_mobile_units_pkey" PRIMARY KEY ("session_id", "unidad_id")
);

CREATE INDEX IF NOT EXISTS "idx_deal_session_mobile_units_unidad_id" ON "deal_session_mobile_units" USING btree ("unidad_id");

-- Foreign keys
ALTER TABLE "deal_sessions"
  ADD CONSTRAINT "deal_sessions_deal_fk" FOREIGN KEY ("deal_id") REFERENCES "deals" ("deal_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "deal_sessions_deal_product_fk" FOREIGN KEY ("deal_product_id") REFERENCES "deal_products" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "deal_sessions_sala_fk" FOREIGN KEY ("sala_id") REFERENCES "salas" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "deal_session_trainers"
  ADD CONSTRAINT "deal_session_trainers_session_fk" FOREIGN KEY ("session_id") REFERENCES "deal_sessions" ("session_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "deal_session_trainers_trainer_fk" FOREIGN KEY ("trainer_id") REFERENCES "trainers" ("trainer_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "deal_session_mobile_units"
  ADD CONSTRAINT "deal_session_mobile_units_session_fk" FOREIGN KEY ("session_id") REFERENCES "deal_sessions" ("session_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "deal_session_mobile_units_unidad_fk" FOREIGN KEY ("unidad_id") REFERENCES "unidades_moviles" ("unidad_id") ON DELETE CASCADE ON UPDATE CASCADE;
