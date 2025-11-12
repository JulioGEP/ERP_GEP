ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "pipeline_label" TEXT;

UPDATE "deals"
SET "pipeline_label" = "pipeline_id"
WHERE "pipeline_label" IS NULL AND "pipeline_id" IS NOT NULL;
