// backend/functions/material-orders.ts
import type { Prisma, PrismaClient } from '@prisma/client';
import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import { isTrustedClient, logSuspiciousRequest } from './_shared/security';
import { requireAuth } from './_shared/auth';
import { sendEmail } from './_shared/mailer';

const LOGISTICS_FALLBACK_SUBJECT = 'Uso de stock desde ERP';

type ProductRequest = {
  productName: string;
  supplierQuantity: number;
  stockQuantity: number;
  totalLabel?: string | null;
};

type CreateMaterialOrderBody = {
  orderNumber?: number;
  supplierName?: string | null;
  supplierEmail?: string | null;
  supplierCc?: string[];
  supplierSubject?: string | null;
  supplierBody?: string | null;
  logisticsTo?: string[];
  logisticsCc?: string[];
  logisticsSubject?: string | null;
  logisticsBody?: string | null;
  products?: ProductRequest[];
  sourceBudgetIds?: string[];
  notes?: string | null;
};

function normalizeString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function normalizeEmail(value: unknown): string | null {
  const text = normalizeString(value);
  if (!text) return null;
  return text.toLowerCase();
}

function normalizeEmailArray(value: unknown): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  const unique = new Set<string>();

  for (const entry of list) {
    const email = normalizeEmail(entry);
    if (email) {
      unique.add(email);
    }
  }

  return Array.from(unique);
}

function normalizeStringArray(value: unknown): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  const unique = new Set<string>();

  for (const entry of list) {
    const text = normalizeString(entry);
    if (text) {
      unique.add(text);
    }
  }

  return Array.from(unique);
}

function normalizeProducts(value: unknown): ProductRequest[] {
  if (!Array.isArray(value)) return [];

  const normalized: ProductRequest[] = [];

  for (const item of value) {
    const name = normalizeString((item as ProductRequest)?.productName);
    if (!name) continue;

    const supplierQuantity = Number((item as ProductRequest)?.supplierQuantity ?? 0);
    const stockQuantity = Number((item as ProductRequest)?.stockQuantity ?? 0);

    normalized.push({
      productName: name,
      supplierQuantity: Number.isFinite(supplierQuantity) ? supplierQuantity : 0,
      stockQuantity: Number.isFinite(stockQuantity) ? stockQuantity : 0,
      totalLabel: normalizeString((item as ProductRequest)?.totalLabel),
    });
  }

  return normalized;
}

function combineEmails(...sources: Array<string[] | null | undefined>): string[] {
  const unique = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    for (const email of source) {
      const normalized = normalizeEmail(email);
      if (normalized) unique.add(normalized);
    }
  }
  return Array.from(unique);
}

function serializeOrder(order: Prisma.pedidosGetPayload<{}>) {
  return {
    id: order.id,
    orderNumber: order.order_number,
    createdAt: order.created_at,
    supplierName: order.supplier_name,
    supplierEmail: order.supplier_email,
    recipientEmail: order.recipient_email,
    ccEmails: order.cc_emails ?? [],
    products: order.products,
    sourceBudgetIds: order.source_budget_ids ?? [],
    notes: order.notes,
    sentFrom: order.sent_from,
  };
}

async function getNextOrderNumber(prisma: Prisma.TransactionClient | PrismaClient): Promise<number> {
  const aggregate = await prisma.pedidos.aggregate({ _max: { order_number: true } });
  const currentMax = aggregate._max.order_number ?? 0;
  return currentMax + 1;
}

function buildProductsPayload(
  products: ProductRequest[],
  supplierEmail: { to: string; cc: string[]; subject: string; body: string },
  logisticsEmail: { to: string[]; cc: string[]; subject: string; body: string } | null,
) {
  return {
    items: products,
    supplierEmail,
    logisticsEmail,
  };
}

function resolveRecipientEmail(supplierEmail: string | null, logisticsTo: string[]): string | null {
  if (logisticsTo.length) return logisticsTo[0];
  return supplierEmail;
}

export const handler = createHttpHandler<CreateMaterialOrderBody>(async (request) => {
  const prisma = getPrisma();

  if (!isTrustedClient(request.headers)) {
    await logSuspiciousRequest({
      event: request.event,
      headers: request.headers,
      method: request.method,
      path: request.path,
      rawUrl: request.event.rawUrl,
      reason: 'Untrusted client for material orders',
      prisma,
    });
    return errorResponse('FORBIDDEN', 'Cliente no autorizado', 403);
  }

  const auth = await requireAuth(request, prisma);
  if ('error' in auth) {
    return auth.error;
  }

  if (request.method === 'GET') {
    const orders = await prisma.pedidos.findMany({ orderBy: { created_at: 'desc' } });
    const nextOrderNumber = await getNextOrderNumber(prisma);
    return successResponse({
      orders: orders.map(serializeOrder),
      nextOrderNumber,
    });
  }

  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  if (!request.body || typeof request.body !== 'object') {
    return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
  }

  const supplierEmail = normalizeEmail(request.body.supplierEmail);
  const supplierSubject = normalizeString(request.body.supplierSubject);
  const supplierBody = normalizeString(request.body.supplierBody);
  const supplierCc = normalizeEmailArray(request.body.supplierCc);
  const logisticsTo = normalizeEmailArray(request.body.logisticsTo);
  const logisticsCc = normalizeEmailArray(request.body.logisticsCc);
  const logisticsSubject = normalizeString(request.body.logisticsSubject) ?? LOGISTICS_FALLBACK_SUBJECT;
  const logisticsBody = normalizeString(request.body.logisticsBody);
  const products = normalizeProducts(request.body.products);
  const sourceBudgetIds = normalizeStringArray(request.body.sourceBudgetIds);
  const notes = normalizeString(request.body.notes);

  if (!supplierEmail) {
    return errorResponse('VALIDATION_ERROR', 'El correo del proveedor es obligatorio', 400);
  }

  if (!supplierSubject || !supplierBody) {
    return errorResponse('VALIDATION_ERROR', 'Asunto y cuerpo del correo al proveedor son obligatorios', 400);
  }

  if (!products.length) {
    return errorResponse('VALIDATION_ERROR', 'Debes incluir al menos un producto en el pedido', 400);
  }

  if (!sourceBudgetIds.length) {
    return errorResponse('VALIDATION_ERROR', 'Falta el identificador del presupuesto origen', 400);
  }

  const hasLogisticsEmail = logisticsTo.length > 0 && Boolean(logisticsBody);

  const orderNumber = Number.isFinite(request.body.orderNumber)
    ? Number(request.body.orderNumber)
    : await getNextOrderNumber(prisma);

  const ccEmails = combineEmails(supplierCc, logisticsCc);
  const recipientEmail = resolveRecipientEmail(supplierEmail, logisticsTo);

  const supplierEmailPayload = {
    to: supplierEmail,
    cc: supplierCc,
    subject: supplierSubject,
    body: supplierBody,
  };

  const logisticsEmailPayload = hasLogisticsEmail
    ? {
        to: logisticsTo,
        cc: logisticsCc,
        subject: logisticsSubject,
        body: logisticsBody!,
      }
    : null;

  await sendEmail({
    to: supplierEmailPayload.to,
    cc: supplierEmailPayload.cc,
    subject: supplierEmailPayload.subject,
    text: supplierEmailPayload.body,
  });

  if (logisticsEmailPayload) {
    await sendEmail({
      to: logisticsEmailPayload.to.join(', '),
      cc: logisticsEmailPayload.cc,
      subject: logisticsEmailPayload.subject,
      text: logisticsEmailPayload.body,
    });
  }

  const created = await prisma.pedidos.create({
    data: {
      order_number: orderNumber,
      supplier_name: normalizeString(request.body.supplierName),
      supplier_email: supplierEmail,
      recipient_email: recipientEmail,
      cc_emails: ccEmails,
      products: buildProductsPayload(products, supplierEmailPayload, logisticsEmailPayload),
      source_budget_ids: sourceBudgetIds,
      notes,
    },
  });

  return successResponse({
    order: serializeOrder(created),
    nextOrderNumber: orderNumber + 1,
  });
});
