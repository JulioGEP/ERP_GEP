-- Create the invite status enum if it does not already exist
DO $$
BEGIN
  CREATE TYPE "TrainerSessionInviteStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

-- Create the variant_trainer_invites table
CREATE TABLE IF NOT EXISTS "variant_trainer_invites" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "variant_id" UUID NOT NULL,
  "trainer_id" TEXT NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "status" "TrainerSessionInviteStatus" NOT NULL DEFAULT 'PENDING',
  "sent_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "responded_at" TIMESTAMPTZ,
  "created_by_user_id" UUID,
  "created_by_email" TEXT,
  "created_by_name" TEXT,
  "trainer_email" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "variant_trainer_invites_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "variant_trainer_invites_trainer_id_fkey"
    FOREIGN KEY ("trainer_id") REFERENCES "trainers"("trainer_id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- Maintain the indexes used by Prisma
CREATE UNIQUE INDEX IF NOT EXISTS "variant_trainer_invites_variant_id_trainer_id_key"
  ON "variant_trainer_invites" ("variant_id", "trainer_id");
CREATE INDEX IF NOT EXISTS "idx_variant_trainer_invites_variant_id"
  ON "variant_trainer_invites" ("variant_id");
CREATE INDEX IF NOT EXISTS "idx_variant_trainer_invites_trainer_id"
  ON "variant_trainer_invites" ("trainer_id");
CREATE INDEX IF NOT EXISTS "idx_variant_trainer_invites_created_by_user_id"
  ON "variant_trainer_invites" ("created_by_user_id");
