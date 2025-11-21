import type { HandlerEvent, HandlerContext } from '@netlify/functions';

import {
  COMMON_HEADERS,
  errorResponse,
  preflightResponse,
  successResponse,
} from './response';
import { isTrustedClient, logSuspiciousRequest } from './security';

export type NetlifyHandlerEvent = HandlerEvent & {
  body?: string | null;
  rawUrl?: string;
  rawQuery?: string;
};

export type NetlifyHandlerContext = HandlerContext & Record<string, unknown>;

const REFRESH_SESSION_COOKIE_CONTEXT_KEY = '__erpSessionRefreshCookie__';

export type HttpHandlerResult =
  | ReturnType<typeof successResponse>
  | ReturnType<typeof errorResponse>
  | {
      statusCode: number;
      headers?: Record<string, string>;
      body?: unknown;
      isBase64Encoded?: boolean;
      [key: string]: unknown;
    }
  | Record<string, unknown>
  | void
  | null;

export interface HttpRequest<TBody = unknown> {
  event: NetlifyHandlerEvent;
  context: NetlifyHandlerContext;
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string | undefined>;
  rawBody: string | null;
  body: TBody | null;
}

export type HttpHandler<TBody = unknown> = (
  request: HttpRequest<TBody>,
) => Promise<HttpHandlerResult> | HttpHandlerResult;

export function setRefreshSessionCookie<TBody = unknown>(
  request: HttpRequest<TBody>,
  cookie: string | null | undefined,
): void {
  if (typeof cookie !== 'string' || !cookie.length) {
    return;
  }
  (request.context as any)[REFRESH_SESSION_COOKIE_CONTEXT_KEY] = cookie;
}

function consumeRefreshSessionCookie(
  context: NetlifyHandlerContext,
): string | null {
  const stored = (context as any)[REFRESH_SESSION_COOKIE_CONTEXT_KEY];
  if (typeof stored !== 'string' || !stored.length) {
    return null;
  }
  delete (context as any)[REFRESH_SESSION_COOKIE_CONTEXT_KEY];
  return stored;
}

function safeStringify(payload: unknown): string {
  return JSON.stringify(payload, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}

function normalizeIncomingHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== 'object') {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!key) continue;
    if (Array.isArray(value)) {
      result[key.toLowerCase()] = value.filter(Boolean).join(', ');
    } else if (value === undefined || value === null) {
      continue;
    } else {
      result[key.toLowerCase()] = String(value);
    }
  }

  return result;
}

function normalizeQueryParams(query: unknown): Record<string, string | undefined> {
  if (!query || typeof query !== 'object') {
    return {};
  }

  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(query)) {
    if (!key) continue;
    if (value === undefined || value === null) {
      result[key] = undefined;
    } else if (Array.isArray(value)) {
      result[key] = value.length ? String(value[0]) : undefined;
    } else {
      result[key] = String(value);
    }
  }

  return result;
}

function decodeBody(event: NetlifyHandlerEvent):
  | { rawBody: string | null }
  | { error: ReturnType<typeof errorResponse> } {
  const raw = event.body;
  if (raw === undefined || raw === null) {
    return { rawBody: null };
  }

  const value = typeof raw === 'string' ? raw : String(raw);
  if (!event.isBase64Encoded) {
    return { rawBody: value };
  }

  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    return { rawBody: decoded };
  } catch (error) {
    console.error('[http] Failed to decode base64 body', error);
    return {
      error: errorResponse('INVALID_BODY', 'Cuerpo codificado inválido', 400),
    };
  }
}

function parseJsonBody(
  rawBody: string | null,
): { body: any } | { error: ReturnType<typeof errorResponse> } {
  if (rawBody === null) {
    return { body: null };
  }

  const trimmed = rawBody.trim();
  if (!trimmed.length) {
    return { body: null };
  }

  try {
    return { body: JSON.parse(trimmed) };
  } catch (error) {
    console.error('[http] Invalid JSON body received', error);
    return {
      error: errorResponse('INVALID_JSON', 'El cuerpo debe ser JSON válido', 400),
    };
  }
}

function isNetlifyResponse(result: unknown): result is {
  statusCode: number;
  headers?: Record<string, string>;
  body?: unknown;
  isBase64Encoded?: boolean;
  [key: string]: unknown;
} {
  return Boolean(
    result &&
      typeof result === 'object' &&
      'statusCode' in result &&
      typeof (result as any).statusCode === 'number',
  );
}

function normalizeHandlerResult(result: HttpHandlerResult) {
  if (result === undefined || result === null) {
    return successResponse();
  }

  if (!isNetlifyResponse(result)) {
    return successResponse(result);
  }

  const headers = { ...COMMON_HEADERS, ...(result.headers ?? {}) };
  if (result.body === undefined) {
    return { ...result, headers, body: '' };
  }

  if (typeof result.body === 'string') {
    return { ...result, headers };
  }

  return { ...result, headers, body: safeStringify(result.body) };
}

export function createHttpHandler<TBody = unknown>(handler: HttpHandler<TBody>) {
  return async function netlifyHandler(
    event: NetlifyHandlerEvent,
    context: NetlifyHandlerContext,
  ) {
    const method = String(event.httpMethod || 'GET').toUpperCase();
    if (method === 'OPTIONS') {
      return preflightResponse();
    }

    const decodedBody = decodeBody(event);
    if ('error' in decodedBody) {
      return decodedBody.error;
    }

    const parsedBody = parseJsonBody(decodedBody.rawBody);
    if ('error' in parsedBody) {
      return parsedBody.error;
    }

    const request: HttpRequest<TBody> = {
      event,
      context,
      method,
      path: event.path || '',
      headers: normalizeIncomingHeaders(event.headers),
      query: normalizeQueryParams(event.queryStringParameters),
      rawBody: decodedBody.rawBody,
      body: parsedBody.body as TBody,
    };

    if (!isTrustedClient(request.headers)) {
      await logSuspiciousRequest({
        event,
        headers: event.headers,
        method,
        path: request.path,
        rawUrl: event.rawUrl ?? null,
        reason: 'missing_or_invalid_client_header',
      });

      return errorResponse(
        'FORBIDDEN',
        'Cliente no autorizado para acceder al backend',
        403,
      );
    }

    try {
      const result = await handler(request);
      const refreshCookie = consumeRefreshSessionCookie(request.context);
      const normalized = normalizeHandlerResult(result);

      if (refreshCookie && !normalized.headers?.['Set-Cookie']) {
        normalized.headers = { ...(normalized.headers ?? {}), 'Set-Cookie': refreshCookie };
      }

      return normalized;
    } catch (error) {
      const message = (() => {
        if (error instanceof Error) {
          return error.message || 'Se ha producido un error inesperado';
        }
        if (typeof error === 'string' && error.trim()) {
          return error.trim();
        }
        return 'Se ha producido un error inesperado';
      })();

      console.error(
        `[http] Unexpected error processing ${method} ${request.path}`,
        error,
      );
      return errorResponse('UNEXPECTED_ERROR', message, 500);
    }
  };
}
