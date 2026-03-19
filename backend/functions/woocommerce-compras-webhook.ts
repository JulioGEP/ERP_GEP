import type { Prisma } from '@prisma/client';
import type { Handler } from '@netlify/functions';
import { COMMON_HEADERS } from './_shared/response';
import { getPrisma } from './_shared/prisma';

const WEBHOOK_KEY = process.env.WEBHOOK_KEY || process.env.webhook_key || '';
const ACCEPTED_STATUSES = new Set(['completed', 'completado']);
const WEBHOOK_HEADERS = {
  ...COMMON_HEADERS,
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Webhook-Key, X-WooCommerce-Webhook-Secret',
};

type JsonObject = Record<string, unknown>;

type OrderSummary = {
  source: string | null;
  eventName: string | null;
  orderId: string | null;
  orderNumber: string | null;
  orderStatus: string | null;
  orderTotal: string | null;
  currency: string | null;
  customerName: string | null;
  customerEmail: string | null;
  paymentMethod: string | null;
  payloadJson: JsonObject;
};

function jsonResponse(statusCode: number, body: Record<string, unknown>) {
  return {
    statusCode,
    headers: WEBHOOK_HEADERS,
    body: JSON.stringify(body),
  };
}

function normalizeHeaders(headers: Parameters<Handler>[0]['headers']): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (!key || value === undefined || value === null) continue;
    normalized[key.toLowerCase()] = String(value);
  }
  return normalized;
}

function decodeBody(event: Parameters<Handler>[0]): string | null {
  if (event.body === undefined || event.body === null) {
    return null;
  }

  const value = typeof event.body === 'string' ? event.body : String(event.body);
  if (!event.isBase64Encoded) {
    return value;
  }

  return Buffer.from(value, 'base64').toString('utf8');
}

function parseBody(rawBody: string | null): JsonObject {
  if (!rawBody) {
    return {};
  }

  const trimmed = rawBody.trim();
  if (!trimmed.length) {
    return {};
  }

  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('INVALID_JSON_OBJECT');
  }

  return parsed as JsonObject;
}

function readString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function readNestedObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function joinName(...values: Array<string | null>): string | null {
  const parts = values.map((value) => value?.trim() ?? '').filter((value) => value.length > 0);
  return parts.length ? parts.join(' ') : null;
}

function resolveSecret(
  headers: Record<string, string>,
  body: JsonObject,
  query: Parameters<Handler>[0]['queryStringParameters'],
): string | null {
  const authHeader = readString(headers.authorization);
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    return readString(authHeader.slice(7));
  }

  const candidates = [
    headers['x-webhook-key'],
    headers['x-webhook-secret'],
    headers['x-woocommerce-webhook-secret'],
    query?.key,
    query?.webhook_key,
    query?.webhookKey,
    body.webhook_key,
    body.webhookKey,
    body.secret,
  ];

  for (const candidate of candidates) {
    const value = readString(candidate);
    if (value) return value;
  }

  return null;
}

function resolvePayload(body: JsonObject): JsonObject {
  const nestedCandidates = [body.order, body.data, body.payload];
  for (const candidate of nestedCandidates) {
    const nested = readNestedObject(candidate);
    if (nested && (nested.id !== undefined || nested.status !== undefined || nested.number !== undefined)) {
      return nested;
    }
  }
  return body;
}

function resolveSource(body: JsonObject): string | null {
  return (
    readString(body.source) ??
    readString(body.origin) ??
    readString(body.provider) ??
    readString(body.platform) ??
    'zapier-woocommerce'
  );
}

function resolveEventName(body: JsonObject): string | null {
  return (
    readString(body.event) ??
    readString(body.topic) ??
    readString(body.action) ??
    readString(body.type) ??
    'order.completed'
  );
}

function buildOrderSummary(body: JsonObject): OrderSummary {
  const payload = resolvePayload(body);
  const billing = readNestedObject(payload.billing);
  const shipping = readNestedObject(payload.shipping);

  return {
    source: resolveSource(body),
    eventName: resolveEventName(body),
    orderId: readString(payload.id) ?? readString(body.order_id),
    orderNumber: readString(payload.number) ?? readString(payload.order_number) ?? readString(body.order_number),
    orderStatus: readString(payload.status) ?? readString(body.status),
    orderTotal: readString(payload.total) ?? readString(body.total),
    currency: readString(payload.currency) ?? readString(body.currency),
    customerName:
      joinName(readString(billing?.first_name), readString(billing?.last_name)) ??
      joinName(readString(shipping?.first_name), readString(shipping?.last_name)) ??
      readString(payload.customer_name) ??
      readString(body.customer_name),
    customerEmail:
      readString(billing?.email) ??
      readString(payload.billing_email) ??
      readString(body.customer_email),
    paymentMethod:
      readString(payload.payment_method_title) ??
      readString(payload.payment_method) ??
      readString(body.payment_method),
    payloadJson: body,
  };
}

function isAcceptedStatus(status: string | null): boolean {
  return status !== null && ACCEPTED_STATUSES.has(status.trim().toLowerCase());
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: WEBHOOK_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, {
      ok: false,
      error_code: 'METHOD_NOT_ALLOWED',
      message: 'Método no permitido.',
    });
  }

  if (!WEBHOOK_KEY) {
    console.error('[woocommerce-compras-webhook] Missing WEBHOOK_KEY/webhook_key env var');
    return jsonResponse(500, {
      ok: false,
      error_code: 'WEBHOOK_NOT_CONFIGURED',
      message: 'La clave del webhook no está configurada.',
    });
  }

  let body: JsonObject;
  try {
    body = parseBody(decodeBody(event));
  } catch (error) {
    console.error('[woocommerce-compras-webhook] Invalid JSON payload', error);
    return jsonResponse(400, {
      ok: false,
      error_code: 'INVALID_JSON',
      message: 'El cuerpo debe ser un JSON válido.',
    });
  }

  const headers = normalizeHeaders(event.headers);
  const receivedSecret = resolveSecret(headers, body, event.queryStringParameters);
  if (!receivedSecret || receivedSecret !== WEBHOOK_KEY) {
    return jsonResponse(401, {
      ok: false,
      error_code: 'INVALID_WEBHOOK_KEY',
      message: 'La clave secreta del webhook no es válida.',
    });
  }

  const summary = buildOrderSummary(body);
  if (!isAcceptedStatus(summary.orderStatus)) {
    return jsonResponse(202, {
      ok: true,
      ignored: true,
      message: 'Webhook ignorado porque el pedido no está completado.',
    });
  }

  try {
    const prisma = getPrisma();
    await prisma.woocommerce_compras_webhooks.create({
      data: {
        source: summary.source,
        event_name: summary.eventName,
        order_id: summary.orderId,
        order_number: summary.orderNumber,
        order_status: summary.orderStatus,
        order_total: summary.orderTotal,
        currency: summary.currency,
        customer_name: summary.customerName,
        customer_email: summary.customerEmail,
        payment_method: summary.paymentMethod,
        payload_json: summary.payloadJson as Prisma.InputJsonValue,
      },
    });

    return jsonResponse(200, {
      ok: true,
      stored: true,
    });
  } catch (error) {
    console.error('[woocommerce-compras-webhook] Failed to persist webhook', error);
    return jsonResponse(500, {
      ok: false,
      error_code: 'DATABASE_ERROR',
      message: 'No se pudo guardar el webhook.',
    });
  }
};
