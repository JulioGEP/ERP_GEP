ALTER TABLE "user_documents" ADD COLUMN IF NOT EXISTS "file_size" INTEGER;
ALTER TABLE "user_documents" ADD COLUMN IF NOT EXISTS "file_data" BYTEA;
