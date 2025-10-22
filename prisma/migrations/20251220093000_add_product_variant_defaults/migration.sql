ALTER TABLE "public"."products"
  DROP COLUMN IF EXISTS "default_variant_start",
  DROP COLUMN IF EXISTS "default_variant_end",
  DROP COLUMN IF EXISTS "default_variant_stock_status",
  DROP COLUMN IF EXISTS "default_variant_stock_quantity",
  DROP COLUMN IF EXISTS "default_variant_price",
  ADD COLUMN IF NOT EXISTS "variant_start" DATE,
  ADD COLUMN IF NOT EXISTS "variant_end" DATE,
  ADD COLUMN IF NOT EXISTS "variant_stock_status" TEXT
    CHECK ("variant_stock_status" IN ('Sin valor', 'En stock', 'Sin stock', 'Reservar por adelantado')),
  ADD COLUMN IF NOT EXISTS "variant_stock_quantity" INTEGER,
  ADD COLUMN IF NOT EXISTS "variant_price" NUMERIC(12, 2);
