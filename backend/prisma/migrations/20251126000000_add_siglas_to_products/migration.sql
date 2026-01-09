-- Ensure the products.siglas column exists for Prisma queries
ALTER TABLE "products"
ADD COLUMN IF NOT EXISTS "siglas" TEXT;
