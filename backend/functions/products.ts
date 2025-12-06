// backend/functions/products.ts
import { Prisma } from '@prisma/client';
import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { formatTimeFromDb, parseHHMMToDate } from './_shared/time';
import { toMadridISOString } from './_shared/timezone';

type ProductRecord = {
  id: string;
  id_pipe: string;
  id_woo: bigint | number | null;
  id_price: Prisma.Decimal | number | null;
  id_holded: string | null;
  name: string | null;
  code: string | null;
  category: string | null;
  hora_inicio: Date | string | null;
  hora_fin: Date | string | null;
  type: string | null;
  template: string | null;
  url_formacion: string | null;
  atributos: any[] | null;
  price: Prisma.Decimal | number | null;
  almacen_stock: number | bigint | null;
  provider_ids: number[] | bigint[] | null;
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
  const atributos = Array.isArray(record.atributos)
    ? record.atributos
        .map((item: any) => ({
          nombre: toNullableTrimmedString(item?.nombre),
          valor: toNullableTrimmedString(item?.valor),
          cantidad:
            item?.cantidad === null || item?.cantidad === undefined || Number.isNaN(Number(item.cantidad))
              ? null
              : Number(item.cantidad),
        }))
        .filter(
          (item) =>
            item.nombre !== null &&
            item.valor !== null &&
            item.cantidad !== null &&
            Number.isSafeInteger(item.cantidad) &&
            item.cantidad >= 0,
        )
    : [];

  return {
    id: record.id,
    id_pipe: record.id_pipe,
    id_woo: record.id_woo == null ? null : Number(record.id_woo),
    id_price: record.id_price == null ? null : Number(record.id_price),
    id_holded: record.id_holded ?? null,
    name: record.name ?? null,
    code: record.code ?? null,
    category: record.category ?? null,
    hora_inicio: formatTimeFromDb(record.hora_inicio),
    hora_fin: formatTimeFromDb(record.hora_fin),
    type: record.type ?? null,
    template: record.template ?? null,
    url_formacion: record.url_formacion ?? null,
    price: record.price == null ? null : Number(record.price),
    atributos,
    almacen_stock:
      record.almacen_stock === null || record.almacen_stock === undefined
        ? null
        : Number(record.almacen_stock),
    provider_ids: Array.isArray(record.provider_ids)
      ? record.provider_ids.map((value) => Number(value)).filter((value) => Number.isFinite(value))
      : [],
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

  if (Object.prototype.hasOwnProperty.call(body, 'id_holded')) {
    data.id_holded = toNullableTrimmedString(body.id_holded);
    hasChanges = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'id_price')) {
    const rawValue = body.id_price;

    if (rawValue === '' || rawValue === null || rawValue === undefined) {
      data.id_price = null;
      hasChanges = true;
    } else if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      data.id_price = rawValue;
      hasChanges = true;
    } else {
      const text = String(rawValue).trim();
      const parsed = Number(text);

      if (!Number.isFinite(parsed)) {
        return {
          error: errorResponse('VALIDATION_ERROR', 'El campo id_price debe ser un número válido', 400),
        } as const;
      }

      data.id_price = parsed;
      hasChanges = true;
    }
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

  if (Object.prototype.hasOwnProperty.call(body, 'almacen_stock')) {
    const rawValue = body.almacen_stock;

    if (rawValue === '' || rawValue === null || rawValue === undefined) {
      data.almacen_stock = null;
      hasChanges = true;
    } else if (typeof rawValue === 'bigint') {
      data.almacen_stock = Number(rawValue);
      hasChanges = true;
    } else {
      const text = String(rawValue).trim();
      if (!/^[-+]?\d+$/.test(text)) {
        return {
          error: errorResponse('VALIDATION_ERROR', 'El campo almacen_stock debe ser un número entero válido', 400),
        } as const;
      }

      const parsed = Number(text);
      if (!Number.isSafeInteger(parsed)) {
        return {
          error: errorResponse('VALIDATION_ERROR', 'El campo almacen_stock debe ser un número entero válido', 400),
        } as const;
      }

      data.almacen_stock = parsed;
      hasChanges = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'atributos')) {
    const rawValue = body.atributos;

    if (rawValue == null) {
      data.atributos = [];
      data.almacen_stock = null;
      hasChanges = true;
    } else if (Array.isArray(rawValue)) {
      const parsed = [] as { nombre: string; valor: string; cantidad: number }[];

      for (const item of rawValue) {
        if (!item || typeof item !== 'object') {
          return {
            error: errorResponse('VALIDATION_ERROR', 'Cada atributo debe ser un objeto con nombre, valor y cantidad', 400),
          } as const;
        }

        const nombre = toNullableTrimmedString((item as any).nombre);
        const valor = toNullableTrimmedString((item as any).valor);
        const cantidadValue = (item as any).cantidad;
        const cantidad =
          cantidadValue === null || cantidadValue === undefined || cantidadValue === ''
            ? 0
            : Number(cantidadValue);

        if (!nombre || !valor) {
          return {
            error: errorResponse('VALIDATION_ERROR', 'Cada atributo debe incluir nombre y valor', 400),
          } as const;
        }

        if (!Number.isFinite(cantidad) || !Number.isSafeInteger(Math.trunc(cantidad)) || cantidad < 0) {
          return {
            error: errorResponse('VALIDATION_ERROR', 'La cantidad de cada atributo debe ser un entero mayor o igual a 0', 400),
          } as const;
        }

        parsed.push({ nombre, valor, cantidad: Math.trunc(cantidad) });
      }

      data.atributos = parsed;
      data.almacen_stock = parsed.length ? parsed.reduce((sum, item) => sum + item.cantidad, 0) : null;
      hasChanges = true;
    } else {
      return {
        error: errorResponse('VALIDATION_ERROR', 'atributos debe ser un array de objetos', 400),
      } as const;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'provider_ids')) {
    const rawValue = body.provider_ids;
    if (rawValue == null) {
      data.provider_ids = [];
      hasChanges = true;
    } else if (Array.isArray(rawValue)) {
      const parsed = rawValue
        .map((value) =>
          typeof value === 'bigint'
            ? Number(value)
            : typeof value === 'number'
            ? value
            : Number(String(value).trim()),
        )
        .filter((value) => Number.isInteger(value));

      if (parsed.length !== rawValue.length) {
        return {
          error: errorResponse('VALIDATION_ERROR', 'Todos los proveedores deben ser enteros válidos', 400),
        } as const;
      }

      const uniqueSorted = Array.from(new Set(parsed)).sort((a, b) => a - b);
      data.provider_ids = uniqueSorted;
      hasChanges = true;
    } else {
      return {
        error: errorResponse('VALIDATION_ERROR', 'provider_ids debe ser un array', 400),
      } as const;
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

export const handler = createHttpHandler<any>(async (request) => {
  const prisma = getPrisma();
  const method = request.method;
  const path = request.path;
  const productId = parseProductIdFromPath(path);

  if (method === 'GET' && !productId) {
    const products = await prisma.products.findMany({
      orderBy: [{ name: 'asc' }],
    });

    return successResponse({
      products: products.map((product: any) => normalizeProduct(product as any)),
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
    if (!request.rawBody) {
      return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
    }

    const body = request.body ?? {};
    const result = buildUpdateData(body);
    if ('error' in result) return result.error;

    const updated = await prisma.products.update({
      where: { id: productId },
      data: result.data,
    });

    return successResponse({ product: normalizeProduct(updated as ProductRecord) });
  }

  return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
});
