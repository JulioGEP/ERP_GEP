// backend/functions/google-drive-self-check.ts
import type { Handler } from '@netlify/functions';
import {
  COMMON_HEADERS,
  preflightResponse,
} from './_shared/response';
import {
  ensureGoogleDriveReady,
  GoogleDriveSelfCheckError,
} from './_shared/googleDrive';

function parseForceFlag(event: any): boolean {
  const value =
    event?.queryStringParameters?.force ??
    event?.queryStringParameters?.refresh ??
    event?.queryStringParameters?.recheck;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['1', 'true', 'yes', 'si', 'sí', 'force'].includes(normalized);
  }
  return Boolean(value);
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return preflightResponse();
  }

  const force = parseForceFlag(event);

  try {
    const result = await ensureGoogleDriveReady({ force });
    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify(result),
    };
  } catch (err) {
    const error =
      err instanceof GoogleDriveSelfCheckError
        ? err
        : new GoogleDriveSelfCheckError(
            'GOOGLE_DRIVE_SELF_CHECK_FAILED',
            err instanceof Error ? err.message : String(err ?? 'Error desconocido'),
            502,
          );

    const body: Record<string, unknown> = {
      ok: false,
      error_code: error.code,
      message: error.message,
    };

    if (error.details) {
      body.details = error.details;
    }

    return {
      statusCode: error.statusCode ?? 500,
      headers: COMMON_HEADERS,
      body: JSON.stringify(body),
    };
  }
};
