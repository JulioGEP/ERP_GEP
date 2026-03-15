// backend/functions/material-orders.ts
import type { Prisma, PrismaClient } from '@prisma/client';
import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import { isTrustedClient, logSuspiciousRequest } from './_shared/security';
import { requireAuth } from './_shared/auth';
import { sendEmail } from './_shared/mailer';

const LOGISTICS_FALLBACK_SUBJECT = 'Uso de stock desde ERP';
const MATERIAL_ORDERS_SENDER_EMAIL = 'erp@gepgroup.es';
const MATERIAL_ORDERS_SENDER_NAME = 'Pedidos Material GEP Group';

type ProductRequest = {
  productName: string;
  supplierQuantity: number;
  stockQuantity: number;
  totalLabel?: string | null;
};

type CreateMaterialOrderBody = {
  id?: number;
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
  textoPedido?: string | null;
  pedidoRealizado?: boolean | string | number | null;
  pedidoRecibido?: boolean | string | number | null;
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

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value !== 'string') return false;

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'si' || normalized === 'sí';
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
    textoPedido: order.texto_pedido,
    pedidoRealizado: order.pedido_realizado,
    pedidoRecibido: order.pedido_recibido,
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

function normalizeProductKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isShippingExpense(value: unknown): boolean {
  return normalizeProductKey(value).includes('gastos de envio');
}

function normalizeQuantity(value: unknown): number {
  const quantity = Number(value ?? 0);
  if (!Number.isFinite(quantity) || quantity < 0) return 0;
  return quantity;
}

function addQuantity(map: Map<string, number>, key: string, quantity: number): void {
  if (!key || quantity <= 0) return;
  map.set(key, (map.get(key) ?? 0) + quantity);
}

async function syncMaterialDealReceptionStatus(
  prisma: Prisma.TransactionClient,
  sourceBudgetIds: string[],
): Promise<void> {
  const budgetIds = Array.from(
    new Set(sourceBudgetIds.map((id) => String(id ?? '').trim()).filter((id) => id.length > 0)),
  );

  if (!budgetIds.length) return;

  const [dealProducts, receivedOrders] = await Promise.all([
    prisma.deal_products.findMany({
      where: { deal_id: { in: budgetIds } },
      select: { deal_id: true, name: true, code: true, quantity: true },
    }),
    prisma.pedidos.findMany({
      where: {
        pedido_recibido: true,
        source_budget_ids: { hasSome: budgetIds },
      },
      select: { source_budget_ids: true, products: true },
    }),
  ]);

  const requiredByBudget = new Map<string, Map<string, number>>();
  for (const product of dealProducts) {
    const budgetId = String(product.deal_id ?? '').trim();
    if (!budgetId) continue;

    const key = normalizeProductKey(product.name ?? product.code);
    const quantity = normalizeQuantity(product.quantity);

    if (!key || quantity <= 0 || isShippingExpense(key)) continue;

    if (!requiredByBudget.has(budgetId)) {
      requiredByBudget.set(budgetId, new Map<string, number>());
    }

    addQuantity(requiredByBudget.get(budgetId)!, key, quantity);
  }

  const receivedByBudget = new Map<string, Map<string, number>>();
  for (const order of receivedOrders) {
    const payload =
      order.products && typeof order.products === 'object' && !Array.isArray(order.products)
        ? (order.products as { items?: unknown[] })
        : null;
    const items = Array.isArray(payload?.items) ? payload.items : [];

    const orderBudgetIds = Array.isArray(order.source_budget_ids)
      ? order.source_budget_ids
          .map((id) => String(id ?? '').trim())
          .filter((id) => id.length > 0)
      : [];

    for (const budgetId of orderBudgetIds) {
      if (!budgetIds.includes(budgetId)) continue;

      if (!receivedByBudget.has(budgetId)) {
        receivedByBudget.set(budgetId, new Map<string, number>());
      }

      for (const item of items) {
        const productName = normalizeProductKey((item as { productName?: unknown })?.productName);
        const quantity = normalizeQuantity((item as { supplierQuantity?: unknown })?.supplierQuantity);
        if (!productName || quantity <= 0 || isShippingExpense(productName)) continue;
        addQuantity(receivedByBudget.get(budgetId)!, productName, quantity);
      }
    }
  }

  const updates: Prisma.PrismaPromise<unknown>[] = [];

  for (const budgetId of budgetIds) {
    const requiredProducts = requiredByBudget.get(budgetId);
    if (!requiredProducts || requiredProducts.size === 0) continue;

    const receivedProducts = receivedByBudget.get(budgetId) ?? new Map<string, number>();

    const isComplete = Array.from(requiredProducts.entries()).every(
      ([productKey, requiredQuantity]) => (receivedProducts.get(productKey) ?? 0) >= requiredQuantity,
    );

    updates.push(
      prisma.deals.updateMany({
        where: { deal_id: budgetId },
        data: {
          estado_material: isComplete ? 'Recepción almacén' : 'Recepción Parcial',
        },
      }),
    );
  }

  if (updates.length) {
    await prisma.$transaction(updates);
  }
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

  if (request.method !== 'POST' && request.method !== 'PATCH' && request.method !== 'DELETE') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }


  if (request.method === 'PATCH') {
    if (!request.body || typeof request.body !== 'object') {
      return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
    }

    const body = request.body;
    const orderId = Number(body.id);

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return errorResponse('VALIDATION_ERROR', 'El identificador del pedido es obligatorio', 400);
    }

    const existing = await prisma.pedidos.findUnique({ where: { id: orderId } });

    if (!existing) {
      return errorResponse('NOT_FOUND', 'No se encontró el pedido indicado', 404);
    }

    const textoPedido = normalizeString(body.textoPedido);
    const pedidoRealizado = normalizeBoolean(body.pedidoRealizado);
    const pedidoRecibido = pedidoRealizado && normalizeBoolean(body.pedidoRecibido);

    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.pedidos.update({
        where: { id: orderId },
        data: {
          texto_pedido: textoPedido,
          pedido_realizado: pedidoRealizado,
          pedido_recibido: pedidoRecibido,
        },
      });

      await syncMaterialDealReceptionStatus(tx, order.source_budget_ids ?? []);
      return order;
    });

    return successResponse({ order: serializeOrder(updated) });
  }

  if (request.method === 'DELETE') {
    const orderIdRaw = request.body && typeof request.body === 'object' ? request.body.id : null;
    const orderId = Number(orderIdRaw);

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return errorResponse('VALIDATION_ERROR', 'El identificador del pedido es obligatorio', 400);
    }

    const existing = await prisma.pedidos.findUnique({ where: { id: orderId } });

    if (!existing) {
      return errorResponse('NOT_FOUND', 'No se encontró el pedido indicado', 404);
    }

    await prisma.pedidos.delete({ where: { id: orderId } });

    return successResponse({ deleted: true, id: orderId });
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
  const textoPedido = normalizeString(request.body.textoPedido);
  const pedidoRealizado = normalizeBoolean(request.body.pedidoRealizado);
  const pedidoRecibido = pedidoRealizado && normalizeBoolean(request.body.pedidoRecibido);

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

  const senderFrom = `${MATERIAL_ORDERS_SENDER_NAME} <${MATERIAL_ORDERS_SENDER_EMAIL}>`;

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
      texto_pedido: textoPedido,
      pedido_realizado: pedidoRealizado,
      pedido_recibido: pedidoRecibido,
      sent_from: normalizeEmail(auth.user.email) ?? MATERIAL_ORDERS_SENDER_EMAIL,
    },
  });

  await sendEmail({
    to: supplierEmailPayload.to,
    cc: supplierEmailPayload.cc,
    subject: supplierEmailPayload.subject,
    text: supplierEmailPayload.body,
    from: senderFrom,
  });

  if (logisticsEmailPayload) {
    await sendEmail({
      to: logisticsEmailPayload.to.join(', '),
      cc: logisticsEmailPayload.cc,
      subject: logisticsEmailPayload.subject,
      text: logisticsEmailPayload.body,
      from: senderFrom,
    });
  }

  return successResponse({
    order: serializeOrder(created),
    nextOrderNumber: orderNumber + 1,
  });
});
