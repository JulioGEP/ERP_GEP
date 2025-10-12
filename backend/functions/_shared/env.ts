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

export function getGoogleDriveClientEmail(): string {
  try {
    return requireEnv('GOOGLE_DRIVE_CLIENT_EMAIL');
  } catch (error) {
    return wrapMissingEnvError(error, 'Falta GOOGLE_DRIVE_CLIENT_EMAIL');
  }
}

export function getGoogleDrivePrivateKey(): string {
  let raw: string;
  try {
    raw = requireEnv('GOOGLE_DRIVE_PRIVATE_KEY');
  } catch (error) {
    return wrapMissingEnvError(error, 'Falta GOOGLE_DRIVE_PRIVATE_KEY');
  }
  return normalizeGoogleDrivePrivateKey(raw);
}

export function getGoogleDriveSharedDriveId(): string {
  try {
    return requireEnv('GOOGLE_DRIVE_SHARED_DRIVE_ID');
  } catch (error) {
    return wrapMissingEnvError(error, 'Falta GOOGLE_DRIVE_SHARED_DRIVE_ID');
  }
}
