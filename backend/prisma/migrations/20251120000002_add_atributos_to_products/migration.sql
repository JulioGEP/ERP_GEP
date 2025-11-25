-- Add atributos JSONB column to store per-product stock attributes
ALTER TABLE "products" ADD COLUMN "atributos" JSONB;
