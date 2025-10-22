// backend/functions/products-variants.ts
import type { Prisma } from '@prisma/client';

import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import { toMadridISOString } from './_shared/timezone';

const WOO_BASE = (process.env.WOO_BASE_URL || '').replace(/\/$/, '');
const WOO_KEY = process.env.WOO_KEY || '';
const WOO_SECRET = process.env.WOO_SECRET || '';

type VariantDeletionResult = {
  success: boolean;
  message?: string;
};

function ensureWooConfigured() {
  if (!WOO_BASE || !WOO_KEY || !WOO_SECRET) {
    throw new Error('WooCommerce configuration missing');
  }
}

function parseVariantIdFromPath(path: string): string | null {
  const value = String(path || '');
  const match = value.match(/\/(?:\.netlify\/functions\/)?products-variants\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

async function deleteVariantFromWooCommerce(
  productWooId: bigint,
  variantWooId: bigint,
): Promise<VariantDeletionResult> {
  ensureWooConfigured();

  const token = Buffer.from(`${WOO_KEY}:${WOO_SECRET}`).toString('base64');
  const productId = productWooId.toString();
  const variationId = variantWooId.toString();
  const url = `${WOO_BASE}/wp-json/wc/v3/products/${productId}/variations/${variationId}?force=true`;

  let response: FetchResponse;
  try {
    response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Basic ${token}`,
        Accept: 'application/json',
      },
    });
  } catch (error) {
    console.error('[products-variants] network error deleting WooCommerce variation', {
      productId,
      variationId,
      error,
    });
    throw new Error('No se pudo conectar con WooCommerce');
  }

  if (response.status === 404) {
    // Consideramos la ausencia en WooCommerce como éxito para mantener consistencia
    return {
      success: true,
      message: 'La variante no existe en WooCommerce, se eliminará localmente.',
    };
  }

  if (!response.ok) {
    const text = await response.text();
    let message = `Error al eliminar la variante en WooCommerce (status ${response.status})`;

    if (text) {
      try {
        const data = JSON.parse(text);
        if (data && typeof data === 'object' && typeof data.message === 'string') {
          message = data.message;
        }
      } catch (error) {
        console.error('[products-variants] invalid JSON deleting WooCommerce variation', {
          productId,
          variationId,
          error,
        });
      }
    }

    throw new Error(message);
  }

  return { success: true };
}

type VariantRecord = {
  id: string;
  id_woo: bigint;
  name: string | null;
  status: string | null;
  price: Prisma.Decimal | string | null;
  stock: number | null;
  stock_status: string | null;
  sede: string | null;
  date: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

type ProductRecord = {
  id: string;
  id_woo: bigint | null;
  name: string | null;
  code: string | null;
  category: string | null;
  variants: VariantRecord[];
};

function normalizeVariant(record: VariantRecord) {
  const price = record.price == null ? null : typeof record.price === 'string' ? record.price : record.price.toString();

  return {
    id: record.id,
    id_woo: record.id_woo?.toString(),
    name: record.name ?? null,
    status: record.status ?? null,
    price,
    stock: record.stock ?? null,
    stock_status: record.stock_status ?? null,
    sede: record.sede ?? null,
    date: toMadridISOString(record.date),
    created_at: toMadridISOString(record.created_at),
    updated_at: toMadridISOString(record.updated_at),
  } as const;
}

function normalizeProduct(record: ProductRecord) {
  return {
    id: record.id,
    id_woo: record.id_woo ? record.id_woo.toString() : null,
    name: record.name ?? null,
    code: record.code ?? null,
    category: record.category ?? null,
    variants: record.variants.map(normalizeVariant),
  } as const;
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    const method = event.httpMethod;
    const prisma = getPrisma();

    if (method === 'DELETE') {
      const variantId = parseVariantIdFromPath(event.path || '');

      if (!variantId) {
        return errorResponse('VALIDATION_ERROR', 'ID de variante requerido', 400);
      }

      const variant = await prisma.variants.findUnique({
        where: { id: variantId },
        select: { id: true, id_padre: true, id_woo: true },
      });

      if (!variant) {
        return errorResponse('NOT_FOUND', 'Variante no encontrada', 404);
      }

      let wooMessage: string | undefined;
      try {
        const result = await deleteVariantFromWooCommerce(variant.id_padre, variant.id_woo);
        wooMessage = result.message;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'No se pudo eliminar la variante en WooCommerce';
        return errorResponse('WOO_DELETE_ERROR', message, 502);
      }

      await prisma.variants.delete({ where: { id: variantId } });

      return successResponse({
        ok: true,
        message: wooMessage ?? 'Variante eliminada correctamente',
      });
    }

    if (method !== 'GET') {
      return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
    }

    const productsRaw = await prisma.products.findMany({
      where: {
        id_woo: { not: null },
        variants: { some: {} },
      },
      select: {
        id: true,
        id_woo: true,
        name: true,
        code: true,
        category: true,
        variants: {
          orderBy: [
            { date: 'asc' },
            { name: 'asc' },
          ],
          select: {
            id: true,
            id_woo: true,
            name: true,
            status: true,
            price: true,
            stock: true,
            stock_status: true,
            sede: true,
            date: true,
            created_at: true,
            updated_at: true,
          },
        },
      },
      orderBy: [{ name: 'asc' }],
    });

    const products = productsRaw.map(normalizeProduct);

    return successResponse({ products });
  } catch (error) {
    console.error('[products-variants] handler error', error);
    return errorResponse('UNEXPECTED_ERROR', 'Se ha producido un error inesperado', 500);
  }
};
