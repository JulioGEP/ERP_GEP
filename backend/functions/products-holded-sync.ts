// backend/functions/products-holded-sync.ts
import { Prisma } from '@prisma/client';
import { createHandler, validateClient } from './_shared/handler';
import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';

const HOLDED_BASE_URL = 'https://api.holded.com/api/invoicing/v1/products';

function normalizeProductPrice(value: Prisma.Decimal | number | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractHoldedId(payload: any): string | null {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.id === 'string' && payload.id.trim().length) return payload.id.trim();
  if (typeof payload._id === 'string' && payload._id.trim().length) return payload._id.trim();
  if (typeof payload.productId === 'string' && payload.productId.trim().length) return payload.productId.trim();
  return null;
}

type HoldedSyncAction = 'create' | 'update' | 'error';

type HoldedSyncResult = {
  product_id: string;
  id_pipe: string;
  previous_id_holded: string | null;
  id_holded: string | null;
  action: HoldedSyncAction;
  status: number | null;
  message: string;
};

type HoldedSyncSummary = {
  total: number;
  created: number;
  updated: number;
  errors: number;
};

export const handler = createHandler(async (event) => {
  validateClient(event);

  if (event.httpMethod === 'OPTIONS') {
    return preflightResponse();
  }

  if (String(event.httpMethod || '').toUpperCase() !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
  }

  const apiKey = process.env.API_HOLDED_KEY;
  if (!apiKey) {
    return errorResponse('CONFIG_ERROR', 'API_HOLDED_KEY no está configurado', 500);
  }

  const prisma = getPrisma();
  const products = await prisma.products.findMany({
    where: { active: true },
    orderBy: [{ id_pipe: 'asc' }],
  });

  const results: HoldedSyncResult[] = [];
  const summary: HoldedSyncSummary = { total: products.length, created: 0, updated: 0, errors: 0 };

  for (const product of products) {
    const previousIdHolded = (product as any).id_holded ?? null;
    let idHolded = previousIdHolded ?? null;
    let status: number | null = null;
    let message = '';
    let action: HoldedSyncAction = previousIdHolded ? 'update' : 'create';

    const payload = {
      kind: 'simple',
      name: (product as any).name ?? '',
      sku: `SKU${product.id_pipe}`,
      tax: '21',
      price: normalizeProductPrice((product as any).price),
      subtotal: normalizeProductPrice((product as any).price),
    } as Record<string, unknown>;

    try {
      const url = previousIdHolded ? `${HOLDED_BASE_URL}/${previousIdHolded}` : HOLDED_BASE_URL;
      const method = previousIdHolded ? 'PUT' : 'POST';
      const response = await fetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          key: apiKey,
        },
        body: JSON.stringify(payload),
      });

      status = response.status;
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        action = 'error';
        summary.errors += 1;
        message = (data as any)?.message ?? (data as any)?.error ?? response.statusText ?? 'Error en Holded';
      } else {
        if (previousIdHolded) {
          summary.updated += 1;
        } else {
          summary.created += 1;
        }
        message = (data as any)?.message ?? 'Sincronizado correctamente';

        const holdedId = extractHoldedId(data);
        if (!previousIdHolded && holdedId) {
          idHolded = holdedId;
          await prisma.products.update({
            where: { id: product.id },
            data: { id_holded: holdedId },
          });
        }
      }
    } catch (error) {
      action = 'error';
      summary.errors += 1;
      status = null;
      message = error instanceof Error ? error.message : 'Error desconocido al sincronizar con Holded';
    }

    results.push({
      product_id: product.id,
      id_pipe: product.id_pipe,
      previous_id_holded: previousIdHolded,
      id_holded: idHolded,
      action,
      status,
      message,
    });
  }

  return successResponse({
    summary,
    results,
  });
});
