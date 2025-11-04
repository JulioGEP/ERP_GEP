// backend/functions/_shared/response.ts
import { randomUUID } from 'crypto';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || '*';

export const COMMON_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-User-Name',
  'Content-Type': 'application/json',
};

// Serializador seguro: convierte BigInt a string
function safeStringify(payload: unknown): string {
  return JSON.stringify(payload, (_k, v) =>
    typeof v === 'bigint' ? v.toString() : v
  );
}

/**
 * Respuesta de éxito estándar
 */
export function successResponse(body: any = {}, statusCode = 200) {
  return {
    statusCode,
    headers: COMMON_HEADERS,
    body: safeStringify({ ok: true, ...body }),
  };
}

/**
 * Respuesta de error estándar
 */
export function errorResponse(
  code: string,
  message: string,
  statusCode = 400,
  extra?: Record<string, unknown>,
) {
  const payload: Record<string, unknown> = {
    ok: false,
    error_code: code,
    message,
    requestId: randomUUID(),
  };

  if (extra && typeof extra === 'object') {
    for (const [key, value] of Object.entries(extra)) {
      if (key === 'ok' || key === 'error_code' || key === 'message' || key === 'requestId') continue;
      payload[key] = value;
    }
  }

  return {
    statusCode,
    headers: COMMON_HEADERS,
    body: safeStringify(payload),
  };
}

/**
 * Respuesta para preflight OPTIONS
 */
export function preflightResponse() {
  return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
}
