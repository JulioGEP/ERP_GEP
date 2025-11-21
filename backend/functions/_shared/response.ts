// backend/functions/_shared/response.ts
import { randomUUID } from 'crypto';

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Id, X-User-Name, X-ERP-Client',
  'Access-Control-Allow-Credentials': 'true',
  'Content-Type': 'application/json',
};

export const COMMON_HEADERS: Record<string, string> = {
  ...BASE_HEADERS,
  'Access-Control-Allow-Origin': '*',
};

function resolveAllowedOrigin(originHeader?: string): string | null {
  if (ALLOWED_ORIGINS.includes('*')) {
    return originHeader ?? '*';
  }

  if (!originHeader) return null;

  const normalized = originHeader.toLowerCase();
  const match = ALLOWED_ORIGINS.find((origin) => origin.toLowerCase() === normalized);
  return match ? originHeader : null;
}

export function resolveRequestOrigin(headers: unknown): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;

  const origin = (headers as Record<string, unknown>).origin ??
    (headers as Record<string, unknown>).Origin;

  return typeof origin === 'string' && origin.length ? origin : undefined;
}

let currentAllowedOrigin: string | null = resolveAllowedOrigin(undefined);

function applyCorsOrigin(originHeader?: string): string | null {
  const allowedOrigin = resolveAllowedOrigin(originHeader);
  currentAllowedOrigin = allowedOrigin;

  if (allowedOrigin) {
    COMMON_HEADERS['Access-Control-Allow-Origin'] = allowedOrigin;
  } else {
    delete COMMON_HEADERS['Access-Control-Allow-Origin'];
  }

  return allowedOrigin;
}

export function ensureCors(event: { headers?: unknown } | null | undefined) {
  const allowedOrigin = applyCorsOrigin(resolveRequestOrigin(event?.headers));
  if (!allowedOrigin) {
    return forbiddenOriginResponse();
  }

  return allowedOrigin;
}

function responseHeaders(originOverride?: string) {
  const allowedOrigin = originOverride
    ? applyCorsOrigin(originOverride)
    : currentAllowedOrigin ?? applyCorsOrigin(undefined);

  if (!allowedOrigin) return null;

  return { ...COMMON_HEADERS };
}

function forbiddenOriginResponse() {
  return {
    statusCode: 403,
    headers: { ...BASE_HEADERS },
    body: safeStringify({
      ok: false,
      error_code: 'FORBIDDEN_ORIGIN',
      message: 'Origen no permitido',
      requestId: randomUUID(),
    }),
  };
}

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
  const headers = responseHeaders();
  if (!headers) return forbiddenOriginResponse();

  return {
    statusCode,
    headers,
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
  const headers = responseHeaders();
  if (!headers) return forbiddenOriginResponse();

  return {
    statusCode,
    headers,
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
export function preflightResponse(originHeader?: string) {
  const headers = responseHeaders(originHeader);
  if (!headers) return forbiddenOriginResponse();

  return { statusCode: 204, headers, body: '' };
}
