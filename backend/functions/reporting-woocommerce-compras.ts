import type { JsonValue } from './_shared/audit-log';
import { requireAuth } from './_shared/auth';
import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
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

function parseLimitParam(rawLimit: string | undefined): number {
  if (!rawLimit) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ['Admin'] });
  if ('error' in auth) {
    return auth.error;
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
      payload: record.payload_json,
    })),
  });
});
