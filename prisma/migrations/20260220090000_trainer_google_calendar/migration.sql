CREATE TABLE "trainer_google_credentials" (
    "trainer_id" TEXT NOT NULL,
    "google_user_id" TEXT NOT NULL,
    "email" TEXT,
    "calendar_id" TEXT NOT NULL DEFAULT 'primary',
    "access_token" TEXT,
    "refresh_token" TEXT,
    "scope" TEXT,
    "token_type" TEXT,
    "expiry_date" TIMESTAMPTZ(6),
    "connected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_synced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trainer_google_credentials_pkey" PRIMARY KEY ("trainer_id"),
    CONSTRAINT "trainer_google_credentials_trainer_id_fkey"
        FOREIGN KEY ("trainer_id") REFERENCES "trainers"("trainer_id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "trainer_google_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trainer_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "etag" TEXT,
    "checksum" TEXT,
    "last_synced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trainer_google_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "trainer_google_events_trainer_id_fkey"
        FOREIGN KEY ("trainer_id") REFERENCES "trainers"("trainer_id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "trainer_google_events_resource_key"
    ON "trainer_google_events" ("trainer_id", "resource_type", "resource_id");

CREATE INDEX "idx_trainer_google_events_trainer_id"
    ON "trainer_google_events" ("trainer_id");

CREATE TABLE "trainer_google_oauth_states" (
    "state" TEXT NOT NULL,
    "trainer_id" TEXT NOT NULL,
    "redirect_uri" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "trainer_google_oauth_states_pkey" PRIMARY KEY ("state"),
    CONSTRAINT "trainer_google_oauth_states_trainer_id_fkey"
        FOREIGN KEY ("trainer_id") REFERENCES "trainers"("trainer_id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_trainer_google_oauth_states_trainer_id"
    ON "trainer_google_oauth_states" ("trainer_id");
