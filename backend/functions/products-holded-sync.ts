// backend/functions/products-holded-sync.ts
import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';

const HOLD_BASE_URL = 'https://api.holded.com/api/invoicing/v1';

type HoldedProduct = {
  id?: string;
  name?: string;
  sku?: string;
};

type HoldedProductPayload = {
  name: string;
  sku: string;
  tax: number;
};

type SyncEntry = {
  id_pipe: string;
  sku: string;
  name: string | null;
  action: 'created' | 'updated';
  status: 'success' | 'error';
  message: string;
};

async function holdedRequest<T = any>(
  apiKey: string,
  path: string,
  init?: RequestInit & { body?: Record<string, any> },
): Promise<T> {
  const response = await fetch(`${HOLD_BASE_URL}${path}`, {
    ...init,
    method: init?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      key: apiKey,
      ...(init?.headers || {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });

  const raw = await response.text();
  let json: any = null;

  if (raw) {
    try {
      json = JSON.parse(raw);
    } catch (error) {
      console.warn('[products-holded-sync] respuesta no JSON', error);
      json = null;
    }
  }

  if (!response.ok) {
    const message = json?.message || json?.error || raw || 'Error desconocido al llamar a Holded';
    throw new Error(message);
  }

  return (json ?? {}) as T;
}

async function fetchHoldedProducts(apiKey: string): Promise<HoldedProduct[]> {
  const products = await holdedRequest<HoldedProduct[]>(apiKey, '/products');
  if (!Array.isArray(products)) return [];
  return products;
}

async function updateHoldedProduct(apiKey: string, productId: string, payload: HoldedProductPayload) {
  await holdedRequest(apiKey, `/products/${encodeURIComponent(productId)}`, { method: 'PUT', body: payload });
}

async function createHoldedProduct(apiKey: string, payload: HoldedProductPayload) {
  return holdedRequest<HoldedProduct>(apiKey, '/products', { method: 'POST', body: payload });
}

function buildSku(idPipe: string): string {
  return `SKU${idPipe}`;
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    if (event.httpMethod !== 'POST') {
      return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
    }

    const apiKey = process.env.API_HOLDED_KEY;
    if (!apiKey) {
      return errorResponse('MISSING_CONFIG', 'Falta la clave API de Holded (API_HOLDED_KEY)', 500);
    }

    const prisma = getPrisma();
    const products = await prisma.products.findMany({
      where: { active: true },
      select: { id_pipe: true, name: true },
    });

    const holdedProducts = await fetchHoldedProducts(apiKey);
    const holdedBySku = new Map<string, HoldedProduct>();
    for (const item of holdedProducts) {
      const sku = typeof item?.sku === 'string' ? item.sku.trim() : '';
      if (sku) {
        holdedBySku.set(sku, item);
      }
    }

    const entries: SyncEntry[] = [];
    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const product of products) {
      const sku = buildSku(product.id_pipe);
      const payload: HoldedProductPayload = {
        name: product.name ?? sku,
        sku,
        tax: 21,
      };

      const existing = holdedBySku.get(sku);

      try {
        if (existing?.id) {
          await updateHoldedProduct(apiKey, existing.id, payload);
          updated += 1;
          entries.push({
            id_pipe: product.id_pipe,
            sku,
            name: product.name ?? null,
            action: 'updated',
            status: 'success',
            message: 'Producto actualizado en Holded',
          });
        } else {
          const createdProduct = await createHoldedProduct(apiKey, payload);
          if (createdProduct?.sku) {
            holdedBySku.set(createdProduct.sku, createdProduct);
          }
          created += 1;
          entries.push({
            id_pipe: product.id_pipe,
            sku,
            name: product.name ?? null,
            action: 'created',
            status: 'success',
            message: 'Producto creado en Holded',
          });
        }
      } catch (error) {
        errors += 1;
        const message = error instanceof Error ? error.message : 'Error desconocido al sincronizar con Holded';
        entries.push({
          id_pipe: product.id_pipe,
          sku,
          name: product.name ?? null,
          action: existing ? 'updated' : 'created',
          status: 'error',
          message,
        });
      }
    }

    return successResponse({
      ok: true,
      summary: {
        total: products.length,
        created,
        updated,
        errors,
      },
      entries,
    });
  } catch (error) {
    console.error('[products-holded-sync] handler error', error);
    return errorResponse('UNEXPECTED_ERROR', 'Se ha producido un error inesperado', 500);
  }
};
