-- CreateTable
CREATE TABLE "salas" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sede" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "salas" ADD CONSTRAINT "salas_pkey" PRIMARY KEY ("id");

CREATE INDEX "idx_salas_name" ON "salas" USING btree ("name");
CREATE INDEX "idx_salas_sede" ON "salas" USING btree ("sede");
