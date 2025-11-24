-- SQL manual migration to add provider_ids column to products table
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS provider_ids integer[] NOT NULL DEFAULT ARRAY[]::integer[];
