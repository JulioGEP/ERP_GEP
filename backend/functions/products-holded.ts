import { Prisma } from '@prisma/client';
import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';

const HOLDED_ENDPOINT = 'https://api.holded.com/api/invoicing/v1/products';
const DEFAULT_TAX = 21;

type HoldedSyncResult = {
  productId: string;
  status: 'success' | 'skipped' | 'error';
  holdedId?: string | null;
  message?: string;
};

type ProductForSync = {
  id: string;
  id_pipe: string;
  name: string | null;
  price: Prisma.Decimal | number | null;
  variant_price?: Prisma.Decimal | number | null;
  id_holded?: string | null;
};

function parseNumeric(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const text = String(value).trim();
  if (!text.length) return null;

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSku(idPipe: string): string {
  const sanitized = String(idPipe ?? '').trim();
  return `SKU${sanitized}`;
}

async function createHoldedProduct(apiKey: string, payload: Record<string, unknown>) {
  const response = await fetch(HOLDED_ENDPOINT, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      key: apiKey,
    },
    body: JSON.stringify(payload),
  });

  let json: any = null;
  try {
    json = await response.json();
  } catch (error) {
    // Mantener json como null si no es JSON válido
  }

  if (!response.ok || json?.status !== 1 || !json?.id) {
    const message =
      typeof json?.info === 'string'
        ? json.info
        : typeof json?.message === 'string'
        ? json.message
        : `Error HTTP ${response.status}`;
    throw new Error(message);
  }

  return String(json.id);
}

async function updateHoldedProduct(
  apiKey: string,
  holdedId: string,
  payload: Record<string, unknown>,
) {
  const url = `${HOLDED_ENDPOINT}/${holdedId}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      key: apiKey,
    },
    body: JSON.stringify(payload),
  });

  let json: any = null;
  try {
    json = await response.json();
  } catch (error) {
    // Mantener json como null si no es JSON válido
  }

  if (!response.ok || json?.status !== 1) {
    const message =
      typeof json?.info === 'string'
        ? json.info
        : typeof json?.message === 'string'
        ? json.message
        : `Error HTTP ${response.status}`;
    throw new Error(message);
  }
}

export const handler = createHttpHandler<any>(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
  }

  const ids = Array.isArray(request.body?.productIds)
    ? request.body.productIds.filter((id: unknown) => typeof id === 'string' && id.trim().length)
    : [];

  if (!ids.length) {
    return errorResponse('VALIDATION_ERROR', 'Debe seleccionar al menos un producto', 400);
  }

  const apiKey = process.env.API_HOLDED_KEY;
  if (!apiKey) {
    return errorResponse('CONFIG_ERROR', 'API_HOLDED_KEY no configurada', 500);
  }

  const prisma = getPrisma();
  const products = await prisma.products.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      id_pipe: true,
      name: true,
      price: true,
      variant_price: true,
      id_holded: true,
    },
  });

  const foundIds = new Set(products.map((product) => product.id));
  const missingIds = ids.filter((id) => !foundIds.has(id));
  const results: HoldedSyncResult[] = missingIds.map((id) => ({
    productId: id,
    status: 'error',
    message: 'Producto no encontrado',
  }));

  for (const product of products as ProductForSync[]) {
    const price = parseNumeric(product.price ?? product.variant_price);
    if (!product.name || !product.id_pipe) {
      results.push({
        productId: product.id,
        status: 'skipped',
        holdedId: null,
        message: 'Producto sin nombre o id_pipe',
      });
      continue;
    }

    if (price === null) {
      results.push({
        productId: product.id,
        status: 'skipped',
        holdedId: null,
        message: 'Producto sin precio válido',
      });
      continue;
    }

    try {
      const holdedId = typeof product.id_holded === 'string' ? product.id_holded.trim() : null;
      const basePayload = {
        kind: 'simple',
        name: product.name,
        tax: DEFAULT_TAX,
        sku: buildSku(product.id_pipe),
      };

      if (holdedId) {
        const payload = { ...basePayload, subtotal: price };
        await updateHoldedProduct(apiKey, holdedId, payload);
        results.push({ productId: product.id, status: 'success', holdedId });
      } else {
        const payload = { ...basePayload, price };
        const createdHoldedId = await createHoldedProduct(apiKey, payload);
        await prisma.products.update({
          where: { id: product.id },
          data: { id_holded: createdHoldedId },
        });

        results.push({ productId: product.id, status: 'success', holdedId: createdHoldedId });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      results.push({ productId: product.id, status: 'error', message });
    }
  }

  return successResponse({ results });
});
