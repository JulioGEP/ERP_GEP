import { neon } from "@neondatabase/serverless";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("DATABASE_URL no definido");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function main() {
  await sql`CREATE TABLE IF NOT EXISTS organizations (
    org_id BIGINT PRIMARY KEY,
    name   TEXT
  );`;

  await sql`CREATE TABLE IF NOT EXISTS deals (
    deal_id  BIGINT PRIMARY KEY,
    title    TEXT NOT NULL,
    value    NUMERIC,
    currency TEXT,
    org_id   BIGINT REFERENCES organizations(org_id)
  );`;

  console.log("OK: tablas creadas/verificadas");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
