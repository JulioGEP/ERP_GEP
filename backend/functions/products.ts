// backend/functions/products.ts
import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import { toMadridISOString } from './_shared/timezone';

type ProductRecord = {
  id: string;
  id_pipe: string;
  name: string | null;
  code: string | null;
  category: string | null;
  type: string | null;
  template: string | null;
  url_formacion: string | null;
  active: boolean;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

function parseProductIdFromPath(path: string): string | null {
  const value = String(path || '');
  const match = value.match(/\/(?:\.netlify\/functions\/)?products\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function toNullableTrimmedString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function normalizeProduct(record: ProductRecord) {
  return {
    id: record.id,
    id_pipe: record.id_pipe,
    name: record.name ?? null,
    code: record.code ?? null,
    category: record.category ?? null,
    type: record.type ?? null,
    template: record.template ?? null,
    url_formacion: record.url_formacion ?? null,
    active: Boolean(record.active),
    created_at: toMadridISOString(record.created_at),
    updated_at: toMadridISOString(record.updated_at),
  };
}

function buildUpdateData(body: any) {
  if (!body || typeof body !== 'object') {
    return { error: errorResponse('VALIDATION_ERROR', 'Body inválido', 400) } as const;
  }

  const data: Record<string, any> = {};
  let hasChanges = false;

  if (Object.prototype.hasOwnProperty.call(body, 'template')) {
    const value = toNullableTrimmedString(body.template);
    data.template = value;
    hasChanges = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'url_formacion')) {
    const value = toNullableTrimmedString(body.url_formacion);
    data.url_formacion = value;
    hasChanges = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'active')) {
    data.active = Boolean(body.active);
    hasChanges = true;
  }

  if (!hasChanges) {
    return {
      error: errorResponse('VALIDATION_ERROR', 'No se han proporcionado cambios', 400),
    } as const;
  }

  data.updated_at = new Date();

  return { data } as const;
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    const prisma = getPrisma();
    const method = event.httpMethod;
    const path = event.path || '';
    const productId = parseProductIdFromPath(path);

    if (method === 'GET' && !productId) {
      const products = await prisma.products.findMany({
        orderBy: [{ name: 'asc' }],
      });

      return successResponse({
        products: products.map((product: ProductRecord) => normalizeProduct(product)),
      });
    }

    if (method === 'GET' && productId) {
      const product = await prisma.products.findUnique({
        where: { id: productId },
      });

      if (!product) {
        return errorResponse('NOT_FOUND', 'Producto no encontrado', 404);
      }

      return successResponse({ product: normalizeProduct(product as ProductRecord) });
    }

    if (method === 'PATCH' && productId) {
      if (!event.body) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }

      const body = JSON.parse(event.body || '{}');
      const result = buildUpdateData(body);
      if ('error' in result) return result.error;

      const updated = await prisma.products.update({
        where: { id: productId },
        data: result.data,
      });

      return successResponse({ product: normalizeProduct(updated as ProductRecord) });
    }

    return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
  } catch (error) {
    console.error('[products] handler error', error);
    return errorResponse('UNEXPECTED_ERROR', 'Se ha producido un error inesperado', 500);
  }
};
