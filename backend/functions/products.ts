// backend/functions/products.ts
import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import { formatTimeFromDb, parseHHMMToDate } from './_shared/time';
import { toMadridISOString } from './_shared/timezone';

type ProductRecord = {
  id: string;
  id_pipe: string;
  id_woo: bigint | number | null;
  name: string | null;
  code: string | null;
  category: string | null;
  hora_inicio: Date | string | null;
  hora_fin: Date | string | null;
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
    id_woo: record.id_woo == null ? null : Number(record.id_woo),
    name: record.name ?? null,
    code: record.code ?? null,
    category: record.category ?? null,
    hora_inicio: formatTimeFromDb(record.hora_inicio),
    hora_fin: formatTimeFromDb(record.hora_fin),
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

  if (Object.prototype.hasOwnProperty.call(body, 'hora_inicio')) {
    try {
      data.hora_inicio = parseHHMMToDate(body.hora_inicio);
    } catch (error) {
      return {
        error: errorResponse(
          'VALIDATION_ERROR',
          'El campo hora_inicio debe tener el formato HH:MM',
          400,
        ),
      } as const;
    }
    hasChanges = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'hora_fin')) {
    try {
      data.hora_fin = parseHHMMToDate(body.hora_fin);
    } catch (error) {
      return {
        error: errorResponse(
          'VALIDATION_ERROR',
          'El campo hora_fin debe tener el formato HH:MM',
          400,
        ),
      } as const;
    }
    hasChanges = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'active')) {
    data.active = Boolean(body.active);
    hasChanges = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'id_woo')) {
    const rawValue = body.id_woo;

    if (rawValue === '' || rawValue === null || rawValue === undefined) {
      data.id_woo = null;
      hasChanges = true;
    } else if (typeof rawValue === 'bigint') {
      data.id_woo = rawValue;
      hasChanges = true;
    } else {
      const text = String(rawValue).trim();
      if (!/^[-+]?\d+$/.test(text)) {
        return {
          error: errorResponse('VALIDATION_ERROR', 'El campo id_woo debe ser un número entero válido', 400),
        } as const;
      }

      try {
        data.id_woo = BigInt(text);
        hasChanges = true;
      } catch (error) {
        console.error('[products] invalid id_woo value', error);
        return {
          error: errorResponse('VALIDATION_ERROR', 'El campo id_woo debe ser un número entero válido', 400),
        } as const;
      }
    }
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
