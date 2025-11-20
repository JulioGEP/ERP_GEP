-- Ensure the user_documents.file_size column exists for Prisma queries
ALTER TABLE "user_documents"
ADD COLUMN IF NOT EXISTS "file_size" INTEGER;
