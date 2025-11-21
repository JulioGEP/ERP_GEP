// backend/functions/_shared/response.ts
import { randomUUID } from 'crypto';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || '*';

export const COMMON_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-User-Name, X-ERP-Client',
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
  statusCode = 400
) {
  return {
    statusCode,
    headers: COMMON_HEADERS,
    body: safeStringify({
      ok: false,
      error_code: code,
      message,
      requestId: randomUUID(),
    }),
  };
}

/**
 * Respuesta para preflight OPTIONS
 */
export function preflightResponse() {
  return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
}
