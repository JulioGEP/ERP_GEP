// backend/functions/_shared/response.ts
import type { Handler } from '@netlify/functions';
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

type JsonResponseOptions = {
  statusCode?: number;
  headers?: Record<string, string>;
  setCookie?: string | string[];
};

function applySetCookie(
  headers: Record<string, string>,
  cookie: string | string[] | undefined,
) {
  if (!cookie) return;
  if (Array.isArray(cookie)) {
    if (cookie.length === 1) {
      headers['Set-Cookie'] = cookie[0];
    } else if (cookie.length > 1) {
      headers['Set-Cookie'] = cookie.join(', ');
    }
  } else {
    headers['Set-Cookie'] = cookie;
  }
}

export function jsonOk(payload: unknown = {}, options: JsonResponseOptions = {}) {
  const statusCode = options.statusCode ?? 200;
  const headers = { ...COMMON_HEADERS, ...(options.headers ?? {}) };
  applySetCookie(headers, options.setCookie);
  return {
    statusCode,
    headers,
    body: safeStringify(payload),
  };
}

export function jsonError(
  statusCode: number,
  message: string,
  options: JsonResponseOptions & { code?: string } = {},
) {
  const body = {
    ok: false,
    message,
    ...(options.code ? { code: options.code } : {}),
  };
  return jsonOk(body, { ...options, statusCode });
}

export function withCorsAndCookies(handler: Handler): Handler {
  return async (event, context) => {
    if ((event.httpMethod ?? '').toUpperCase() === 'OPTIONS') {
      return preflightResponse();
    }

    const result = await handler(event, context);
    if (!result) {
      return {
        statusCode: 204,
        headers: COMMON_HEADERS,
        body: '',
      };
    }

    const headers = { ...COMMON_HEADERS, ...(result.headers ?? {}) };
    return { ...result, headers };
  };
}
