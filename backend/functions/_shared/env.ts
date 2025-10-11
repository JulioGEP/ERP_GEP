// backend/functions/_shared/env.ts

const PRIVATE_KEY_HEADER = "-----BEGIN PRIVATE KEY-----";

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || String(v).trim() === "") {
    const err: any = new Error(`ENV_MISSING:${name}`);
    err.code = "ENV_MISSING";
    err.varName = name;
    throw err;
  }
  return String(v);
}

function normalizePrivateKey(raw: string): string {
  const normalized = raw.includes("\n") ? raw : raw.replace(/\\n/g, "\n");
  const headerCheck = normalized.trimStart();
  if (!headerCheck.startsWith(PRIVATE_KEY_HEADER)) {
    const err: any = new Error("ENV_INVALID:GOOGLE_DRIVE_PRIVATE_KEY:INVALID_FORMAT");
    err.code = "ENV_INVALID";
    err.varName = "GOOGLE_DRIVE_PRIVATE_KEY";
    throw err;
  }
  return normalized;
}

export function getGoogleDriveClientEmail(): string {
  return requireEnv("GOOGLE_DRIVE_CLIENT_EMAIL");
}

export function getGoogleDrivePrivateKey(): string {
  const raw = requireEnv("GOOGLE_DRIVE_PRIVATE_KEY");
  return normalizePrivateKey(raw);
}

export function getGoogleDriveSharedDriveId(): string {
  return requireEnv("GOOGLE_DRIVE_SHARED_DRIVE_ID");
}
