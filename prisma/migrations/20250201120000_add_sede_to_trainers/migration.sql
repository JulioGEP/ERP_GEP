-- CreateEnum
-- (none)

-- AlterTable
ALTER TABLE "trainers"
ADD COLUMN     "sede" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
