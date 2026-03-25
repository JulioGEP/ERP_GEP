import type { Prisma } from '@prisma/client';
import type { JsonValue } from './_shared/audit-log';
import { requireAuth } from './_shared/auth';
import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { sendWooOrderToPipedrive } from './_shared/woocommerce-compras-pipedrive';
import { toMadridISOString } from './_shared/timezone';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const DEFAULT_WOO_TIMEOUT_MS = 20000;
const WOO_IMPORT_DATE_CUTOFF = new Date('2026-01-01T00:00:00.000Z');
const WOO_ACCEPTED_STATUSES = new Set(['completed', 'completado']);
const WOO_BASE_URL = (process.env.WOO_BASE_URL ?? '').trim().replace(/\/$/, '');
const WOO_CLIENT_KEY = (process.env.CLAVE_CLIENTE_WC ?? '').trim();
const WOO_CLIENT_SECRET = (process.env.CLAVE_SECRETA_WC ?? '').trim();

type WooCommerceComprasWebhookRecord = {
  id: string;
  created_at: Date;
  source: string | null;
  event_name: string | null;
  order_id: string | null;
  order_number: string | null;
  presupuesto: string | null;
  order_status: string | null;
  order_total: string | null;
  currency: string | null;
  customer_name: string | null;
  customer_email: string | null;
  payment_method: string | null;
  payload_json: JsonValue;
};

type WooOrder = {
  id: string | null;
  number: string | null;
  status: string | null;
  dateCreated: Date | null;
  total: string | null;
  currency: string | null;
  customerName: string | null;
  customerEmail: string | null;
  paymentMethod: string | null;
  presupuesto: string | null;
  payload: Record<string, JsonValue>;
};

function readJsonObject(value: JsonValue | null | undefined): Record<string, JsonValue> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, JsonValue>;
}

function readJsonArray(value: JsonValue | null | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function readText(value: JsonValue | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function resolveCouponCode(payload: JsonValue): string | null {
  const root = readJsonObject(payload);
  const order = readJsonObject(root?.order) ?? root;
  const couponLines = readJsonArray(order?.coupon_lines);

  const couponCodes = couponLines
    .map((entry) => readText(readJsonObject(entry)?.code))
    .filter((value): value is string => Boolean(value));

  if (couponCodes.length) {
    return Array.from(new Set(couponCodes)).join(', ');
  }

  return (
    readText(order?.coupon_code) ??
    readText(order?.discount_code) ??
    readText(root?.coupon_code) ??
    readText(root?.discount_code)
  );
}

function parseLimitParam(rawLimit: string | undefined): number {
  if (!rawLimit) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim().length) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function joinName(first: string | null, last: string | null): string | null {
  const parts = [first, last].map((value) => value?.trim() ?? '').filter((value) => value.length > 0);
  return parts.length ? parts.join(' ') : null;
}

function normalizeStatus(status: string | null): string | null {
  if (!status) return null;
  const normalized = status.trim().toLowerCase();
  return normalized.length ? normalized : null;
}

function isAcceptedStatus(status: string | null): boolean {
  const normalized = normalizeStatus(status);
  return normalized !== null && WOO_ACCEPTED_STATUSES.has(normalized);
}

function sanitizeWooOrder(rawOrder: unknown): WooOrder | null {
  const order = readRecord(rawOrder);
  if (!order) return null;

  const billing = readRecord(order.billing);
  const metaData = Array.isArray(order.meta_data) ? order.meta_data : [];

  const presupuesto = metaData
    .map((entry) => readRecord(entry))
    .find((entry) => {
      const key = readString(entry?.key)?.toLowerCase();
      return key === 'presupuesto' || key === '_presupuesto';
    });

  const dateCreated =
    parseDate(order.date_created_gmt) ??
    parseDate(order.date_created) ??
    parseDate(order.date_paid_gmt) ??
    parseDate(order.date_paid);

  const id = readString(order.id);
  const number = readString(order.number) ?? id;
  if (!id && !number) {
    return null;
  }

  return {
    id,
    number,
    status: readString(order.status),
    dateCreated,
    total: readString(order.total),
    currency: readString(order.currency),
    customerName: joinName(readString(billing?.first_name), readString(billing?.last_name)),
    customerEmail: readString(billing?.email),
    paymentMethod: readString(order.payment_method_title) ?? readString(order.payment_method),
    presupuesto: readString(presupuesto?.value),
    payload: order as unknown as Record<string, JsonValue>,
  };
}

type WooAuthMode = 'header' | 'query';

function buildWooOrdersUrl(page: number, authMode: WooAuthMode): URL {
  const url = new URL(`${WOO_BASE_URL}/wp-json/wc/v3/orders`);
  url.searchParams.set('per_page', '100');
  url.searchParams.set('page', String(page));
  url.searchParams.set('orderby', 'date');
  url.searchParams.set('order', 'desc');

  if (authMode === 'query') {
    url.searchParams.set('consumer_key', WOO_CLIENT_KEY);
    url.searchParams.set('consumer_secret', WOO_CLIENT_SECRET);
  }

  return url;
}

function buildWooHeaders(authMode: WooAuthMode): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (authMode === 'header') {
    const token = Buffer.from(`${WOO_CLIENT_KEY}:${WOO_CLIENT_SECRET}`).toString('base64');
    headers.Authorization = `Basic ${token}`;
  }
  return headers;
}

async function requestWooOrders(page: number): Promise<unknown[]> {
  const modes: WooAuthMode[] = ['header', 'query'];

  for (const mode of modes) {
    const url = buildWooOrdersUrl(page, mode);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_WOO_TIMEOUT_MS);

    try {
      const response = await fetch(url.toString(), {
        headers: buildWooHeaders(mode),
        signal: controller.signal,
      });

      const rawText = await response.text();
      const data = rawText.length ? JSON.parse(rawText) : [];

      if (!response.ok) {
        const shouldRetry = mode === 'header' && (response.status === 401 || response.status === 403);
        if (shouldRetry) {
          continue;
        }

        const message = readString(readRecord(data)?.message) ?? 'No se pudo consultar WooCommerce.';
        throw new Error(`${message} (status ${response.status})`);
      }

      return Array.isArray(data) ? data : [];
    } catch (error) {
      if (mode === 'query') {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('No se pudo autenticar la consulta contra WooCommerce.');
}

type WooImportSummary = {
  importedCount: number;
  latestOrderNumber: string | null;
  latestOrderId: string | null;
  inspectedCount: number;
};

async function importWooCompletedOrders(): Promise<WooImportSummary> {
  if (!WOO_BASE_URL || !WOO_CLIENT_KEY || !WOO_CLIENT_SECRET) {
    throw new Error('Faltan variables de WooCommerce (WOO_BASE_URL, CLAVE_CLIENTE_WC o CLAVE_SECRETA_WC).');
  }

  const prisma = getPrisma();
  let page = 1;
  let importedCount = 0;
  let inspectedCount = 0;
  let latestOrderNumber: string | null = null;
  let latestOrderId: string | null = null;
  let shouldStop = false;

  while (!shouldStop) {
    const entries = await requestWooOrders(page);
    if (!entries.length) {
      break;
    }

    const sanitized = entries
      .map(sanitizeWooOrder)
      .filter((order): order is WooOrder => order !== null);

    if (page === 1 && sanitized.length) {
      latestOrderNumber = sanitized[0].number;
      latestOrderId = sanitized[0].id;
    }

    const eligible = sanitized.filter((order) => {
      if (!isAcceptedStatus(order.status)) return false;
      if (!order.dateCreated) return false;
      return order.dateCreated.getTime() >= WOO_IMPORT_DATE_CUTOFF.getTime();
    });

    inspectedCount += eligible.length;

    if (!eligible.length) {
      const hasOlderOrders = sanitized.some((order) =>
        order.dateCreated ? order.dateCreated.getTime() < WOO_IMPORT_DATE_CUTOFF.getTime() : false,
      );
      shouldStop = hasOlderOrders || sanitized.length < 100;
      page += 1;
      continue;
    }

    const idCandidates = Array.from(new Set(eligible.map((order) => order.id).filter((value): value is string => Boolean(value))));
    const numberCandidates = Array.from(
      new Set(eligible.map((order) => order.number).filter((value): value is string => Boolean(value))),
    );

    const existing = await prisma.woocommerce_compras_webhooks.findMany({
      where: {
        OR: [
          idCandidates.length ? { order_id: { in: idCandidates } } : undefined,
          numberCandidates.length ? { order_number: { in: numberCandidates } } : undefined,
        ].filter(Boolean) as Prisma.woocommerce_compras_webhooksWhereInput[],
      },
      select: {
        order_id: true,
        order_number: true,
      },
    });

    const existingOrderIds = new Set(existing.map((record) => record.order_id).filter((value): value is string => Boolean(value)));
    const existingOrderNumbers = new Set(
      existing.map((record) => record.order_number).filter((value): value is string => Boolean(value)),
    );

    const missingOrders = eligible.filter((order) => {
      const existsById = order.id ? existingOrderIds.has(order.id) : false;
      const existsByNumber = order.number ? existingOrderNumbers.has(order.number) : false;
      return !existsById && !existsByNumber;
    });

    if (missingOrders.length) {
      await prisma.woocommerce_compras_webhooks.createMany({
        data: missingOrders.map((order) => ({
          source: 'woocommerce_api_pull',
          event_name: 'order.completed.sync',
          order_id: order.id,
          order_number: order.number,
          presupuesto: order.presupuesto,
          order_status: order.status,
          order_total: order.total,
          currency: order.currency,
          customer_name: order.customerName,
          customer_email: order.customerEmail,
          payment_method: order.paymentMethod,
          payload_json: order.payload as Prisma.InputJsonValue,
        })),
      });
      importedCount += missingOrders.length;
    }

    const hasOlderOrders = sanitized.some((order) =>
      order.dateCreated ? order.dateCreated.getTime() < WOO_IMPORT_DATE_CUTOFF.getTime() : false,
    );
    shouldStop = hasOlderOrders || sanitized.length < 100;
    page += 1;
  }

  return {
    importedCount,
    latestOrderNumber,
    latestOrderId,
    inspectedCount,
  };
}

export const handler = createHttpHandler(async (request) => {
  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ['Admin'] });
  if ('error' in auth) {
    return auth.error;
  }

  if (request.method === 'DELETE') {
    const eventId = typeof request.body === 'object' && request.body !== null ? String((request.body as any).eventId ?? '').trim() : '';
    if (!eventId.length) {
      return errorResponse('VALIDATION_ERROR', 'El identificador del webhook es obligatorio.', 400);
    }

    try {
      await prisma.woocommerce_compras_webhooks.delete({
        where: { id: eventId },
      });

      return successResponse({
        message: 'Webhook eliminado correctamente.',
      });
    } catch (error) {
      console.error('[reporting-woocommerce-compras] delete webhook failed', error);
      return errorResponse(
        'WEBHOOK_DELETE_ERROR',
        error instanceof Error ? error.message : 'No se pudo eliminar el webhook.',
        500,
      );
    }
  }

  if (request.method === 'PUT') {
    try {
      const result = await importWooCompletedOrders();
      return successResponse({
        message: 'Sincronización de pedidos completados finalizada.',
        result,
      });
    } catch (error) {
      console.error('[reporting-woocommerce-compras] woo pull failed', error);
      return errorResponse(
        'WOO_PULL_ERROR',
        error instanceof Error ? error.message : 'No se pudo consultar WooCommerce.',
        500,
      );
    }
  }

  if (request.method === 'POST') {
    const eventId = typeof request.body === 'object' && request.body !== null ? String((request.body as any).eventId ?? '').trim() : '';
    if (!eventId.length) {
      return errorResponse('VALIDATION_ERROR', 'El identificador del webhook es obligatorio.', 400);
    }

    try {
      const result = await sendWooOrderToPipedrive({
        prisma,
        webhookEventId: eventId,
      });

      return successResponse({
        message: 'Pedido enviado a Pipedrive correctamente.',
        result,
      });
    } catch (error) {
      console.error('[reporting-woocommerce-compras] send to Pipedrive failed', error);
      return errorResponse(
        'PIPEDRIVE_SYNC_ERROR',
        error instanceof Error ? error.message : 'No se pudo enviar el pedido a Pipedrive.',
        500,
      );
    }
  }

  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const records = (await prisma.woocommerce_compras_webhooks.findMany({
    orderBy: { created_at: 'desc' },
    take: parseLimitParam(request.query.limit),
  })) as WooCommerceComprasWebhookRecord[];

  return successResponse({
    events: records.map((record) => ({
      id: record.id,
      createdAt: toMadridISOString(record.created_at),
      source: record.source,
      eventName: record.event_name,
      orderId: record.order_id,
      orderNumber: record.order_number,
      presupuesto: record.presupuesto,
      orderStatus: record.order_status,
      orderTotal: record.order_total,
      currency: record.currency,
      customerName: record.customer_name,
      customerEmail: record.customer_email,
      paymentMethod: record.payment_method,
      couponCode: resolveCouponCode(record.payload_json),
      payload: record.payload_json,
    })),
  });
});
