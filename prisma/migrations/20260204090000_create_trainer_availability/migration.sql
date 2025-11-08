CREATE TABLE "trainer_availability" (
    "trainer_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT TRUE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "trainer_availability"
    ADD CONSTRAINT "trainer_availability_pkey" PRIMARY KEY ("trainer_id", "date");

CREATE INDEX "idx_trainer_availability_date" ON "trainer_availability" ("date");

ALTER TABLE "trainer_availability"
    ADD CONSTRAINT "trainer_availability_trainer_id_fkey"
    FOREIGN KEY ("trainer_id") REFERENCES "trainers"("trainer_id")
    ON DELETE CASCADE ON UPDATE CASCADE;
