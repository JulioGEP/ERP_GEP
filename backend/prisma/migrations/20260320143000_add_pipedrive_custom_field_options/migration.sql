CREATE TABLE "pipedrive_custom_field_options" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "field_key" VARCHAR(64) NOT NULL,
  "field_name" VARCHAR(255) NOT NULL,
  "field_type" VARCHAR(64) NOT NULL,
  "option_id" VARCHAR(64) NOT NULL,
  "option_label" VARCHAR(500) NOT NULL,
  "option_order" INTEGER NOT NULL DEFAULT 0,
  "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

  CONSTRAINT "pipedrive_custom_field_options_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ux_pipedrive_custom_field_options_field_option"
  ON "pipedrive_custom_field_options" ("field_key", "option_id");

CREATE INDEX "idx_pipedrive_custom_field_options_field_order"
  ON "pipedrive_custom_field_options" ("field_key", "option_order");

CREATE INDEX "idx_pipedrive_custom_field_options_synced_at"
  ON "pipedrive_custom_field_options" ("synced_at");
