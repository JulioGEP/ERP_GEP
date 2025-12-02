import type { Handler } from '@netlify/functions';
import { COMMON_HEADERS } from './_shared/response';
import { getPrisma } from './_shared/prisma';

const EXPECTED_TOKEN = process.env.PIPEDRIVE_WEBHOOK_TOKEN;

function normalizeHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== 'object') return {};

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!key) continue;
    if (value === undefined || value === null) continue;
    normalized[key.toLowerCase()] = Array.isArray(value)
      ? value.filter(Boolean).join(', ')
      : String(value);
  }
  return normalized;
}

function decodeBody(event: Parameters<Handler>[0]):
  | { rawBody: string | null }
  | { error: ReturnType<Handler> } {
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
    console.error('[pipedrive-webhook] Failed to decode base64 body', error);
    return {
      error: {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: JSON.stringify({
          ok: false,
          error_code: 'INVALID_BODY',
          message: 'Cuerpo codificado inválido',
        }),
      },
    };
  }
}

function parseJsonBody(rawBody: string | null):
  | { body: any }
  | { error: ReturnType<Handler> } {
  if (rawBody === null) {
    return { body: {} };
  }

  const trimmed = rawBody.trim();
  if (!trimmed.length) {
    return { body: {} };
  }

  try {
    return { body: JSON.parse(trimmed) };
  } catch (error) {
    console.error('[pipedrive-webhook] Invalid JSON body received', error);
    return {
      error: {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: JSON.stringify({
          ok: false,
          error_code: 'INVALID_JSON',
          message: 'El cuerpo debe ser JSON válido',
        }),
      },
    };
  }
}

function normalizeNullableInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveToken(
  headers: Record<string, string>,
  body: Record<string, unknown>,
): string | null {
  const headerCandidates = [
    headers['x-pipedrive-webhook-token'],
    headers['x-pipedrive-token'],
    headers['x-pipedrive-signature'],
  ];

  for (const candidate of headerCandidates) {
    if (typeof candidate === 'string' && candidate.trim().length) {
      return candidate.trim();
    }
  }

  const bodyToken = (() => {
    const direct = body?.['webhook_token'];
    if (typeof direct === 'string' && direct.trim().length) return direct.trim();

    const metaToken =
      typeof body.meta === 'object' && body.meta !== null
        ? (body.meta as any).webhook_token
        : null;
    if (typeof metaToken === 'string' && metaToken.trim().length)
      return metaToken.trim();

    return null;
  })();

  return bodyToken;
}

function filterHeaders(headers: Record<string, string>): Record<string, string> | null {
  const allowedPrefixes = ['x-pipedrive-'];
  const allowedKeys = new Set(['content-type']);

  const entries = Object.entries(headers).filter(([key]) =>
    allowedKeys.has(key) || allowedPrefixes.some((prefix) => key.startsWith(prefix)),
  );

  if (!entries.length) return null;

  return Object.fromEntries(entries);
}

function buildErrorResponse(statusCode: number, code: string, message: string) {
  return {
    statusCode,
    headers: COMMON_HEADERS,
    body: JSON.stringify({ ok: false, error_code: code, message }),
  };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return buildErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Solo se admite POST');
  }

  const normalizedHeaders = normalizeHeaders(event.headers);
  const decoded = decodeBody(event);
  if ('error' in decoded) return decoded.error;

  const parsed = parseJsonBody(decoded.rawBody);
  if ('error' in parsed) return parsed.error;

  const body = parsed.body as Record<string, unknown>;
  const resolvedToken = resolveToken(normalizedHeaders, body);

  if (EXPECTED_TOKEN && resolvedToken !== EXPECTED_TOKEN) {
    return buildErrorResponse(401, 'INVALID_TOKEN', 'Token de webhook no válido');
  }

  const prisma = getPrisma();
  await prisma.pipedrive_webhook_events.create({
    data: {
      event: typeof body.event === 'string' ? body.event : null,
      event_action:
        typeof body.meta === 'object' && body.meta !== null &&
        typeof (body.meta as any).action === 'string'
          ? (body.meta as any).action
          : null,
      event_object:
        typeof body.meta === 'object' && body.meta !== null &&
        typeof (body.meta as any).object === 'string'
          ? (body.meta as any).object
          : null,
      company_id:
        typeof body.meta === 'object' && body.meta !== null
          ? normalizeNullableInt((body.meta as any).company_id)
          : null,
      object_id:
        typeof body.meta === 'object' && body.meta !== null
          ? normalizeNullableInt((body.meta as any).id)
          : null,
      retry: normalizeNullableInt(body.retry),
      webhook_token: resolvedToken,
      headers: filterHeaders(normalizedHeaders),
      payload: body ?? {},
    },
  });

  return { statusCode: 200, headers: COMMON_HEADERS, body: JSON.stringify({ ok: true }) };
};
