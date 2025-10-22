// backend/functions/products-variants.ts
import { Prisma } from '@prisma/client';

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

type WooVariationAttribute = {
  id?: number;
  name?: string;
  option?: string;
  slug?: string;
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

const LOCATION_KEYWORDS = ['localizacion', 'ubicacion', 'sede'];
const DATE_KEYWORDS = ['fecha'];

function normalizeAttributeText(value: string | undefined | null): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function matchesAttributeKeywords(attribute: WooVariationAttribute, keywords: string[]): boolean {
  const normalizedName = normalizeAttributeText(attribute?.name ?? attribute?.slug ?? null);
  if (!normalizedName) return false;

  return keywords.some((keyword) => normalizedName.includes(keyword));
}

function formatDateAttributeValue(date: Date | null): string {
  if (!date) return '';

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  return `${day}/${month}/${year}`;
}

type VariantUpdateInput = {
  price?: string | null;
  stock?: number | null;
  stock_status?: string | null;
  status?: string | null;
  sede?: string | null;
  date?: Date | null;
};

async function fetchWooVariation(
  productWooId: bigint,
  variantWooId: bigint,
  authToken: string,
): Promise<{ attributes: WooVariationAttribute[] }> {
  const productId = productWooId.toString();
  const variationId = variantWooId.toString();
  const url = `${WOO_BASE}/wp-json/wc/v3/products/${productId}/variations/${variationId}`;

  let response: FetchResponse;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Basic ${authToken}`,
        Accept: 'application/json',
      },
    });
  } catch (error) {
    console.error('[products-variants] network error fetching WooCommerce variation', {
      productId,
      variationId,
      error,
    });
    throw new Error('No se pudo conectar con WooCommerce');
  }

  const text = await response.text();
  let data: any = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      console.error('[products-variants] invalid JSON fetching WooCommerce variation', {
        productId,
        variationId,
        error,
        text,
      });
      throw new Error('Respuesta inválida de WooCommerce');
    }
  }

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && typeof data.message === 'string'
        ? data.message
        : `Error al consultar WooCommerce (status ${response.status})`;
    throw new Error(message);
  }

  const attributes = Array.isArray(data?.attributes) ? (data.attributes as WooVariationAttribute[]) : [];

  return { attributes };
}

async function updateVariantInWooCommerce(
  productWooId: bigint,
  variantWooId: bigint,
  updates: VariantUpdateInput,
): Promise<void> {
  ensureWooConfigured();

  const token = Buffer.from(`${WOO_KEY}:${WOO_SECRET}`).toString('base64');
  const productId = productWooId.toString();
  const variationId = variantWooId.toString();
  const url = `${WOO_BASE}/wp-json/wc/v3/products/${productId}/variations/${variationId}`;

  const body: Record<string, any> = {};

  if (Object.prototype.hasOwnProperty.call(updates, 'price')) {
    body.price = updates.price ?? '';
    body.regular_price = updates.price ?? '';
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'stock')) {
    if (updates.stock === null || updates.stock === undefined) {
      body.manage_stock = false;
      body.stock_quantity = null;
    } else {
      body.manage_stock = true;
      body.stock_quantity = updates.stock;
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'stock_status')) {
    body.stock_status = updates.stock_status ?? 'instock';
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
    body.status = updates.status ?? 'publish';
  }

  if (
    Object.prototype.hasOwnProperty.call(updates, 'sede') ||
    Object.prototype.hasOwnProperty.call(updates, 'date')
  ) {
    const { attributes } = await fetchWooVariation(productWooId, variantWooId, token);
    const updatedAttributes = attributes.map((attribute) => ({ ...attribute }));

    let attributesChanged = false;
    let sedeMatched = false;
    let dateMatched = false;

    if (Object.prototype.hasOwnProperty.call(updates, 'sede')) {
      const newValue = updates.sede ?? '';
      for (const attribute of updatedAttributes) {
        if (!matchesAttributeKeywords(attribute, LOCATION_KEYWORDS)) continue;
        sedeMatched = true;
        if ((attribute.option ?? '') !== newValue) {
          attribute.option = newValue;
          attributesChanged = true;
        }
      }
      if (!sedeMatched) {
        console.warn('[products-variants] no WooCommerce attribute matched for sede update', {
          productId,
          variationId,
        });
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'date')) {
      const newValue = formatDateAttributeValue(updates.date ?? null);
      for (const attribute of updatedAttributes) {
        if (!matchesAttributeKeywords(attribute, DATE_KEYWORDS)) continue;
        dateMatched = true;
        if ((attribute.option ?? '') !== newValue) {
          attribute.option = newValue;
          attributesChanged = true;
        }
      }
      if (!dateMatched) {
        console.warn('[products-variants] no WooCommerce attribute matched for date update', {
          productId,
          variationId,
        });
      }
    }

    if (attributesChanged) {
      body.attributes = updatedAttributes;
    }
  }

  if (!Object.keys(body).length) {
    return;
  }

  let response: FetchResponse;
  try {
    response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Basic ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error('[products-variants] network error updating WooCommerce variation', {
      productId,
      variationId,
      updates,
      error,
    });
    throw new Error('No se pudo conectar con WooCommerce');
  }

  const text = await response.text();
  let data: any = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      console.error('[products-variants] invalid JSON updating WooCommerce variation', {
        productId,
        variationId,
        updates,
        error,
        text,
      });
      throw new Error('Respuesta inválida de WooCommerce');
    }
  }

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && typeof data.message === 'string'
        ? data.message
        : `Error al actualizar la variante en WooCommerce (status ${response.status})`;
    throw new Error(message);
  }
}

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

    if (method === 'PATCH') {
      const variantId = parseVariantIdFromPath(event.path || '');

      if (!variantId) {
        return errorResponse('VALIDATION_ERROR', 'ID de variante requerido', 400);
      }

      if (!event.body) {
        return errorResponse('VALIDATION_ERROR', 'Cuerpo de la petición requerido', 400);
      }

      let payload: any;
      try {
        payload = JSON.parse(event.body);
      } catch (error) {
        return errorResponse('VALIDATION_ERROR', 'JSON inválido', 400);
      }

      const updates: VariantUpdateInput = {};

      if (Object.prototype.hasOwnProperty.call(payload, 'price')) {
        const rawPrice = payload.price;
        if (rawPrice === null || rawPrice === undefined || rawPrice === '') {
          updates.price = null;
        } else {
          const text = String(rawPrice).replace(',', '.').trim();
          if (!text || Number.isNaN(Number(text))) {
            return errorResponse('VALIDATION_ERROR', 'Precio inválido', 400);
          }
          updates.price = text;
        }
      }

      if (Object.prototype.hasOwnProperty.call(payload, 'stock')) {
        const rawStock = payload.stock;
        if (rawStock === null || rawStock === undefined || rawStock === '') {
          updates.stock = null;
        } else {
          const numberValue = Number(rawStock);
          if (!Number.isFinite(numberValue)) {
            return errorResponse('VALIDATION_ERROR', 'Stock inválido', 400);
          }
          updates.stock = Math.trunc(numberValue);
        }
      }

      if (Object.prototype.hasOwnProperty.call(payload, 'stock_status')) {
        if (payload.stock_status === null || payload.stock_status === undefined || payload.stock_status === '') {
          updates.stock_status = 'instock';
        } else {
          updates.stock_status = String(payload.stock_status).trim();
        }
      }

      if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
        if (payload.status === null || payload.status === undefined || payload.status === '') {
          updates.status = 'publish';
        } else {
          const text = String(payload.status).trim().toLowerCase();
          if (text !== 'publish' && text !== 'private') {
            return errorResponse('VALIDATION_ERROR', 'Estado de publicación inválido', 400);
          }
          updates.status = text;
        }
      }

      if (Object.prototype.hasOwnProperty.call(payload, 'sede')) {
        if (payload.sede === null || payload.sede === undefined) {
          updates.sede = null;
        } else {
          updates.sede = String(payload.sede).trim();
        }
      }

      if (Object.prototype.hasOwnProperty.call(payload, 'date')) {
        if (payload.date === null || payload.date === undefined || payload.date === '') {
          updates.date = null;
        } else {
          const text = String(payload.date).trim();
          const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

          if (isoMatch) {
            const [, yearText, monthText, dayText] = isoMatch;
            const year = Number.parseInt(yearText, 10);
            const month = Number.parseInt(monthText, 10);
            const day = Number.parseInt(dayText, 10);

            if (
              !Number.isFinite(year) ||
              !Number.isFinite(month) ||
              !Number.isFinite(day) ||
              month < 1 ||
              month > 12 ||
              day < 1 ||
              day > 31
            ) {
              return errorResponse('VALIDATION_ERROR', 'Fecha inválida', 400);
            }

            updates.date = new Date(Date.UTC(year, month - 1, day));
          } else {
            const parsed = new Date(text);
            if (Number.isNaN(parsed.getTime())) {
              return errorResponse('VALIDATION_ERROR', 'Fecha inválida', 400);
            }
            updates.date = parsed;
          }
        }
      }

      if (!Object.keys(updates).length) {
        return errorResponse('VALIDATION_ERROR', 'No se proporcionaron cambios', 400);
      }

      const existing = await prisma.variants.findUnique({
        where: { id: variantId },
        select: {
          id: true,
          id_woo: true,
          id_padre: true,
          name: true,
          status: true,
          price: true,
          stock: true,
          stock_status: true,
          sede: true,
          date: true,
        },
      });

      if (!existing) {
        return errorResponse('NOT_FOUND', 'Variante no encontrada', 404);
      }

      try {
        await updateVariantInWooCommerce(existing.id_padre, existing.id_woo, updates);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'No se pudo actualizar la variante en WooCommerce';
        return errorResponse('WOO_UPDATE_ERROR', message, 502);
      }

      const timestamp = new Date();
      const data: Prisma.variantsUpdateInput = { updated_at: timestamp };

      if (Object.prototype.hasOwnProperty.call(updates, 'price')) {
        data.price = updates.price === null || updates.price === undefined ? null : new Prisma.Decimal(updates.price);
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'stock')) {
        data.stock = updates.stock ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'stock_status')) {
        data.stock_status = updates.stock_status ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
        data.status = updates.status ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'sede')) {
        data.sede = updates.sede ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'date')) {
        data.date = updates.date ?? null;
      }

      await prisma.variants.update({
        where: { id: variantId },
        data,
      });

      const refreshed = await prisma.variants.findUnique({
        where: { id: variantId },
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
      });

      return successResponse({ ok: true, variant: refreshed ? normalizeVariant(refreshed) : null });
    }

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
