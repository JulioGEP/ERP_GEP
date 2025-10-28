// backend/functions/_lib/http.ts
import { randomUUID } from 'crypto';

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || '*';

export const COMMON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-User-Name',
};

function safeStringify(payload: unknown): string {
  // Evita errores con BigInt en respuestas JSON
  return JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

export const json = (body: any, status = 200) => ({
  statusCode: status,
  headers: COMMON_HEADERS,
  body: safeStringify(body),
});

export const ok = (body: any = { ok: true }) => json(body, 200);

export const err = (code: string, message: string, status = 500) =>
  json(
    {
      ok: false,
      error_code: code,
      message,
      requestId: randomUUID(),
    },
    status
  );

// Respuesta para preflight CORS
export const preflight = () => ({ statusCode: 204, headers: COMMON_HEADERS, body: '' });

// Lectura homogénea de usuario desde cabeceras
export function getUser(event: any) {
  const h = event?.headers || {};
  const userId = h['x-user-id'] || h['X-User-Id'] || null;
  const userName = h['x-user-name'] || h['X-User-Name'] || null;
  return { userId: userId ? String(userId) : null, userName: userName ? String(userName) : null };
}

/** Aliases para mantener compatibilidad con _shared/response si se necesitara */
export const successResponse = ok;
export const errorResponse = err;
