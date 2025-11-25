-- Add atributos JSONB column to store per-product stock attributes
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'products'
          AND column_name = 'atributos'
    ) THEN
        ALTER TABLE "products" ADD COLUMN "atributos" JSONB;
    END IF;
END;
$$;
