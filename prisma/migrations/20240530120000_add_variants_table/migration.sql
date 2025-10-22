-- Add unique constraint to ensure WooCommerce IDs are unique per product
ALTER TABLE "public"."products"
  ADD CONSTRAINT "products_id_woo_key" UNIQUE ("id_woo");

-- Create variants table linked to WooCommerce product IDs
CREATE TABLE "public"."variants" (
  "id"         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  "id_woo"     BIGINT      NOT NULL,
  "name"       TEXT,
  "status"     TEXT,
  "price"      NUMERIC(12, 2),
  "stock"      INTEGER,
  "stock_status" TEXT,
  "sede"       TEXT,
  "date"       TIMESTAMP,
  "id_padre"   BIGINT      NOT NULL,
  "created_at" TIMESTAMPTZ DEFAULT now(),
  "updated_at" TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT "variants_id_woo_key" UNIQUE ("id_woo"),
  CONSTRAINT "variants_product_fk"
    FOREIGN KEY ("id_padre")
    REFERENCES "public"."products" ("id_woo")
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

CREATE INDEX "idx_variants_id_padre" ON "public"."variants" ("id_padre");
CREATE INDEX "idx_variants_status" ON "public"."variants" ("status");
