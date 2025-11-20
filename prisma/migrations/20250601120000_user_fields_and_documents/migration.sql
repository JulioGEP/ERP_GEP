-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "bank_account" NUMERIC(34,0),
  ADD COLUMN "address" TEXT,
  ADD COLUMN "signup_date" DATE,
  ADD COLUMN "drive_folder_id" TEXT;

-- CreateTable
CREATE TABLE "user_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "mime_type" TEXT,
  "drive_file_id" TEXT,
  "drive_folder_id" TEXT,
  "drive_web_view_link" TEXT,
  "drive_web_content_link" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "user_documents"
  ADD CONSTRAINT "user_documents_pkey" PRIMARY KEY ("id");

ALTER TABLE "user_documents"
  ADD CONSTRAINT "user_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "idx_user_documents_user_id" ON "user_documents" USING btree ("user_id");
