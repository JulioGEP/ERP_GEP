/*
  Warnings:

  - You are about to drop the `Deal` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DealParticipant` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Document` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `MobileUnit` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Note` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Organization` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Person` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Session` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SessionMobileUnit` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SessionTrainer` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Trainer` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "DocumentOrigin" AS ENUM ('imported', 'user_upload');

-- CreateEnum
CREATE TYPE "dealproducttype" AS ENUM ('TRAINING', 'EXTRA');

-- DropForeignKey
ALTER TABLE "Deal" DROP CONSTRAINT "Deal_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "DealParticipant" DROP CONSTRAINT "DealParticipant_dealId_fkey";

-- DropForeignKey
ALTER TABLE "DealParticipant" DROP CONSTRAINT "DealParticipant_personId_fkey";

-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_dealId_fkey";

-- DropForeignKey
ALTER TABLE "Note" DROP CONSTRAINT "Note_dealId_fkey";

-- DropForeignKey
ALTER TABLE "Person" DROP CONSTRAINT "Person_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_dealId_fkey";

-- DropForeignKey
ALTER TABLE "SessionMobileUnit" DROP CONSTRAINT "SessionMobileUnit_mobileId_fkey";

-- DropForeignKey
ALTER TABLE "SessionMobileUnit" DROP CONSTRAINT "SessionMobileUnit_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "SessionTrainer" DROP CONSTRAINT "SessionTrainer_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "SessionTrainer" DROP CONSTRAINT "SessionTrainer_trainerId_fkey";

-- DropTable
DROP TABLE "Deal";

-- DropTable
DROP TABLE "DealParticipant";

-- DropTable
DROP TABLE "Document";

-- DropTable
DROP TABLE "MobileUnit";

-- DropTable
DROP TABLE "Note";

-- DropTable
DROP TABLE "Organization";

-- DropTable
DROP TABLE "Person";

-- DropTable
DROP TABLE "Session";

-- DropTable
DROP TABLE "SessionMobileUnit";

-- DropTable
DROP TABLE "SessionTrainer";

-- DropTable
DROP TABLE "Trainer";

-- CreateTable
CREATE TABLE "organizations" (
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "CIF" TEXT,
    "telf_org" TEXT,
    "address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cif" TEXT,
    "phone" TEXT,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("org_id")
);

-- CreateTable
CREATE TABLE "persons" (
    "person_id" TEXT NOT NULL,
    "person_org_id" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "org_id" TEXT,

    CONSTRAINT "persons_pkey" PRIMARY KEY ("person_id")
);

-- CreateTable
CREATE TABLE "deals" (
    "deal_id" TEXT NOT NULL,
    "alumnos" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT,
    "org_id" BIGINT,
    "pipeline_id" TEXT,
    "training_address" TEXT,
    "sede_label" TEXT,
    "caes_label" TEXT,
    "fundae_label" TEXT,
    "hotel_label" TEXT,
    "person_id" TEXT,
    "extras" JSON NOT NULL DEFAULT '[]',
    "prodextra" JSON NOT NULL DEFAULT '[]',
    "hours" TEXT,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("deal_id")
);

-- CreateTable
CREATE TABLE "comments" (
    "comment_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "author_name" TEXT,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("comment_id")
);

-- CreateTable
CREATE TABLE "deal_products" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT,
    "product_id" TEXT,
    "name" TEXT,
    "code" TEXT,
    "quantity" DECIMAL,
    "price" DECIMAL,
    "is_training" BOOLEAN,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "dealproducttype",

    CONSTRAINT "deal_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_files" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT,
    "product_id" TEXT,
    "file_name" TEXT,
    "file_url" TEXT,
    "file_type" TEXT,
    "added_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_notes" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT,
    "product_id" TEXT,
    "content" TEXT,
    "author" TEXT,
    "created_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "deal_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seassons" (
    "seasson_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "status" TEXT,
    "date_start" TIMESTAMP(3),
    "date_end" TIMESTAMP(3),
    "sede" TEXT,
    "seasson_address" TEXT,
    "seasson_fireman" TEXT,
    "seasson_vehicle" TEXT,
    "comment_seasson" TEXT,

    CONSTRAINT "seassons_pkey" PRIMARY KEY ("seasson_id")
);

-- CreateTable
CREATE TABLE "trainers" (
    "trainer_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainers_pkey" PRIMARY KEY ("trainer_id")
);

-- CreateTable
CREATE TABLE "unidades_moviles" (
    "unidad_id" TEXT NOT NULL,
    "name" TEXT,
    "plate" TEXT,
    "capacity_liters" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unidades_moviles_pkey" PRIMARY KEY ("unidad_id")
);

-- CreateIndex
CREATE INDEX "persons_person_org_id_idx" ON "persons"("person_org_id");

-- CreateIndex
CREATE INDEX "comments_author_id_idx" ON "comments"("author_id");

-- CreateIndex
CREATE INDEX "comments_deal_id_idx" ON "comments"("deal_id");

-- CreateIndex
CREATE INDEX "deal_products_deal_id_idx" ON "deal_products"("deal_id");

-- CreateIndex
CREATE INDEX "deal_products_type_idx" ON "deal_products"("type");

-- CreateIndex
CREATE INDEX "seassons_deal_id_idx" ON "seassons"("deal_id");

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_person_org_id_fkey" FOREIGN KEY ("person_org_id") REFERENCES "organizations"("org_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("deal_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seassons" ADD CONSTRAINT "seassons_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("deal_id") ON DELETE CASCADE ON UPDATE CASCADE;
