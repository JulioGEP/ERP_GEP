ALTER TABLE "deal_products"
ADD COLUMN IF NOT EXISTS "product_id" UUID;

CREATE INDEX IF NOT EXISTS "idx_deal_products_product_id"
  ON "deal_products" ("product_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'deal_products_product_fk'
  ) THEN
    ALTER TABLE "deal_products"
      ADD CONSTRAINT "deal_products_product_fk"
      FOREIGN KEY ("product_id") REFERENCES "products"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
