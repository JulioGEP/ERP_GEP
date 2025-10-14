-- CreateTable
CREATE TABLE "session_public_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deal_id" TEXT NOT NULL,
    "sesion_id" UUID NOT NULL,
    "token" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "last_access_at" TIMESTAMPTZ(6),
    "last_access_ip" VARCHAR(64),
    "last_access_ua" VARCHAR(512),
    CONSTRAINT "session_public_links_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "session_public_links"
ADD CONSTRAINT "session_public_links_deal_fk"
FOREIGN KEY ("deal_id") REFERENCES "deals"("deal_id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "session_public_links"
ADD CONSTRAINT "session_public_links_session_fk"
FOREIGN KEY ("sesion_id") REFERENCES "sesiones"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes
CREATE UNIQUE INDEX "ux_session_public_links_token" ON "session_public_links"("token");
CREATE INDEX "idx_session_public_links_deal_id" ON "session_public_links"("deal_id");
CREATE INDEX "idx_session_public_links_sesion_id" ON "session_public_links"("sesion_id");
