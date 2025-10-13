// backend/functions/_shared/env.ts
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || String(v).trim() === '') {
    const err: any = new Error(`ENV_MISSING:${name}`);
    err.code = 'ENV_MISSING';
    err.varName = name;
    throw err;
  }
  return String(v);
}

function normalizeGoogleDrivePrivateKey(raw: string): string {
  return raw.includes('\n') ? raw : raw.replace(/\\n/g, '\n');
}

function wrapMissingEnvError(originalError: unknown, message: string): never {
  const err = new Error(message);
  (err as any).cause = originalError;
  throw err;
}

type GoogleDriveEnvConfig = {
  clientEmail: string | null;
  privateKey: string | null;
  sharedDriveId: string | null;
  driveDisabled: boolean;
  missingVariables: string[];
};

let cachedGoogleDriveConfig: GoogleDriveEnvConfig | null = null;

function readEnvValue(name: string): string | null {
  const value = process.env[name];
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function computeGoogleDriveConfig(): GoogleDriveEnvConfig {
  const rawClientEmail = readEnvValue('GOOGLE_DRIVE_CLIENT_EMAIL');
  const rawPrivateKey = readEnvValue('GOOGLE_DRIVE_PRIVATE_KEY');
  const rawSharedDriveId = readEnvValue('GOOGLE_DRIVE_SHARED_DRIVE_ID');

  const missingVariables: string[] = [];
  if (!rawClientEmail) missingVariables.push('GOOGLE_DRIVE_CLIENT_EMAIL');
  if (!rawPrivateKey) missingVariables.push('GOOGLE_DRIVE_PRIVATE_KEY');
  if (!rawSharedDriveId) missingVariables.push('GOOGLE_DRIVE_SHARED_DRIVE_ID');

  const privateKey = rawPrivateKey ? normalizeGoogleDrivePrivateKey(rawPrivateKey) : null;

  return {
    clientEmail: rawClientEmail,
    privateKey,
    sharedDriveId: rawSharedDriveId,
    driveDisabled: missingVariables.length > 0,
    missingVariables,
  };
}

export function getGoogleDriveConfig(): GoogleDriveEnvConfig {
  if (!cachedGoogleDriveConfig) {
    cachedGoogleDriveConfig = computeGoogleDriveConfig();
  }
  return cachedGoogleDriveConfig;
}

export function isGoogleDriveDisabled(): boolean {
  return getGoogleDriveConfig().driveDisabled;
}

export function getGoogleDriveClientEmail(): string {
  const { clientEmail } = getGoogleDriveConfig();
  if (clientEmail) return clientEmail;
  try {
    return requireEnv('GOOGLE_DRIVE_CLIENT_EMAIL');
  } catch (error) {
    return wrapMissingEnvError(error, 'Falta GOOGLE_DRIVE_CLIENT_EMAIL');
  }
}

export function getGoogleDrivePrivateKey(): string {
  const { privateKey } = getGoogleDriveConfig();
  if (privateKey) return privateKey;
  let raw: string;
  try {
    raw = requireEnv('GOOGLE_DRIVE_PRIVATE_KEY');
  } catch (error) {
    return wrapMissingEnvError(error, 'Falta GOOGLE_DRIVE_PRIVATE_KEY');
  }
  return normalizeGoogleDrivePrivateKey(raw);
}

export function getGoogleDriveSharedDriveId(): string {
  const { sharedDriveId } = getGoogleDriveConfig();
  if (sharedDriveId) return sharedDriveId;
  try {
    return requireEnv('GOOGLE_DRIVE_SHARED_DRIVE_ID');
  } catch (error) {
    return wrapMissingEnvError(error, 'Falta GOOGLE_DRIVE_SHARED_DRIVE_ID');
  }
}
