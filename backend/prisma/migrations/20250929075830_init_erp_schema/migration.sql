-- CreateTable
CREATE TABLE "Organization" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "cif" VARCHAR(255),
    "phone" VARCHAR(255),
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" INTEGER NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "firstName" VARCHAR(255),
    "lastName" VARCHAR(255),
    "email" VARCHAR(255),
    "phone" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" INTEGER NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "trainingType" VARCHAR(255),
    "hours" INTEGER,
    "direction" VARCHAR(255),
    "sede" VARCHAR(255),
    "caes" VARCHAR(255),
    "fundae" VARCHAR(255),
    "hotelNight" VARCHAR(255),
    "alumnos" INTEGER DEFAULT 0,
    "training" JSONB,
    "prodExtra" JSONB,
    "documentsNum" INTEGER DEFAULT 0,
    "documentsIds" TEXT,
    "sessionsNum" INTEGER DEFAULT 0,
    "sessionsIds" TEXT,
    "notesNum" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" INTEGER NOT NULL,
    "dealId" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" INTEGER NOT NULL,
    "dealId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "dealId" INTEGER NOT NULL,
    "status" VARCHAR(255),
    "dateStart" TIMESTAMP(3),
    "dateEnd" TIMESTAMP(3),
    "sede" VARCHAR(255),
    "address" TEXT,
    "firemanId" VARCHAR(255),
    "vehicleId" VARCHAR(255),
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trainer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trainer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileUnit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobileUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionTrainer" (
    "sessionId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,

    CONSTRAINT "SessionTrainer_pkey" PRIMARY KEY ("sessionId","trainerId")
);

-- CreateTable
CREATE TABLE "SessionMobileUnit" (
    "sessionId" TEXT NOT NULL,
    "mobileId" TEXT NOT NULL,

    CONSTRAINT "SessionMobileUnit_pkey" PRIMARY KEY ("sessionId","mobileId")
);

-- CreateTable
CREATE TABLE "DealParticipant" (
    "dealId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "role" VARCHAR(255),

    CONSTRAINT "DealParticipant_pkey" PRIMARY KEY ("dealId","personId")
);

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionTrainer" ADD CONSTRAINT "SessionTrainer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionTrainer" ADD CONSTRAINT "SessionTrainer_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "Trainer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionMobileUnit" ADD CONSTRAINT "SessionMobileUnit_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionMobileUnit" ADD CONSTRAINT "SessionMobileUnit_mobileId_fkey" FOREIGN KEY ("mobileId") REFERENCES "MobileUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealParticipant" ADD CONSTRAINT "DealParticipant_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealParticipant" ADD CONSTRAINT "DealParticipant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
