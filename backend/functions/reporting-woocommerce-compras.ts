import type { JsonValue } from './_shared/audit-log';
import { requireAuth } from './_shared/auth';
import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { sendWooOrderToPipedrive } from './_shared/woocommerce-compras-pipedrive';
import { toMadridISOString } from './_shared/timezone';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

type WooCommerceComprasWebhookRecord = {
  id: string;
  created_at: Date;
  source: string | null;
  event_name: string | null;
  order_id: string | null;
  order_number: string | null;
  order_status: string | null;
  order_total: string | null;
  currency: string | null;
  customer_name: string | null;
  customer_email: string | null;
  payment_method: string | null;
  payload_json: JsonValue;
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
