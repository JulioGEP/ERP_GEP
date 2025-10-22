ALTER TABLE "public"."products"
  ADD COLUMN "default_variant_start" TIMESTAMPTZ,
  ADD COLUMN "default_variant_end" TIMESTAMPTZ,
  ADD COLUMN "default_variant_stock_status" VARCHAR(32),
  ADD COLUMN "default_variant_stock_quantity" INTEGER,
  ADD COLUMN "default_variant_price" NUMERIC(12, 2);
