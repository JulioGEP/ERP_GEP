import { Prisma } from '@prisma/client';

import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import { toMadridISOString } from './_shared/timezone';
import { mapApiStockStatusToDbValue, mapDbStockStatusToApiValue } from './_shared/variant-defaults';

type ProductDefaultsRecord = {
  id: string;
  default_variant_start: Date | string | null;
  default_variant_end: Date | string | null;
  default_variant_stock_status: string | null;
  default_variant_stock_quantity: number | null;
  default_variant_price: Prisma.Decimal | string | null;
  hora_inicio: string | null;
  hora_fin: string | null;
};

type ProductDefaultsPayload = {
  product_id?: string;
  start_date?: string | null;
  end_date?: string | null;
  stock_status?: string | null;
  stock_quantity?: number | null;
  price?: string | null;
  hora_inicio?: string | null;
  hora_fin?: string | null;
};

function normalizeDefaults(record: ProductDefaultsRecord) {
  return {
    id: record.id,
    default_variant_start: toMadridISOString(record.default_variant_start),
    default_variant_end: toMadridISOString(record.default_variant_end),
    default_variant_stock_status: mapDbStockStatusToApiValue(record.default_variant_stock_status),
    default_variant_stock_quantity: record.default_variant_stock_quantity ?? null,
    default_variant_price:
      record.default_variant_price == null
        ? null
        : typeof record.default_variant_price === 'string'
          ? record.default_variant_price
          : record.default_variant_price.toString(),
    hora_inicio: record.hora_inicio ?? null,
    hora_fin: record.hora_fin ?? null,
  } as const;
}

function parseDateInput(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error('INVALID_DATE');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error('INVALID_DATE');
  }
  const [, yearText, monthText, dayText] = match;
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10) - 1;
  const day = Number.parseInt(dayText, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error('INVALID_DATE');
  }
  return new Date(Date.UTC(year, month, day));
}

function parseStockStatus(value: unknown): string | null {
  try {
    return mapApiStockStatusToDbValue(value as string | null | undefined);
  } catch (error) {
    throw new Error('INVALID_STOCK_STATUS');
  }
}

function parseStockQuantity(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('INVALID_STOCK_QUANTITY');
  }
  return Math.max(0, Math.floor(parsed));
}

function parsePrice(value: unknown): Prisma.Decimal | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const normalized = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(normalized)) {
    throw new Error('INVALID_PRICE');
  }
  return new Prisma.Decimal(normalized);
}

function parseProductId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('INVALID_PRODUCT_ID');
  }
  return value.trim();
}

function parseTimeInput(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error('INVALID_TIME');
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error('INVALID_TIME');
  }

  const [, hoursText, minutesText] = match;
  const hours = Number.parseInt(hoursText, 10);
  const minutes = Number.parseInt(minutesText, 10);

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    throw new Error('INVALID_TIME');
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error('INVALID_TIME');
  }

  return `${hoursText.padStart(2, '0')}:${minutesText.padStart(2, '0')}`;
}

async function getProduct(prisma: ReturnType<typeof getPrisma>, productId: string) {
  const product = await prisma.products.findUnique({
    where: { id: productId },
    select: {
      id: true,
      default_variant_start: true,
      default_variant_end: true,
      default_variant_stock_status: true,
      default_variant_stock_quantity: true,
      default_variant_price: true,
      hora_inicio: true,
      hora_fin: true,
    },
  });
  return product;
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    const prisma = getPrisma();

    if (event.httpMethod === 'GET') {
      let productId: string;
      try {
        productId = parseProductId(event.queryStringParameters?.product_id ?? null);
      } catch (error) {
        return errorResponse('VALIDATION_ERROR', 'ID de producto inválido', 400);
      }
      const product = await getProduct(prisma, productId);
      if (!product) {
        return errorResponse('NOT_FOUND', 'Producto no encontrado', 404);
      }
      return successResponse({ ok: true, product: normalizeDefaults(product) });
    }

    if (event.httpMethod !== 'PATCH') {
      return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
    }

    if (!event.body) {
      return errorResponse('VALIDATION_ERROR', 'Cuerpo de la petición requerido', 400);
    }

    let payload: ProductDefaultsPayload;
    try {
      payload = JSON.parse(event.body) as ProductDefaultsPayload;
    } catch (error) {
      return errorResponse('VALIDATION_ERROR', 'JSON inválido', 400);
    }

    let productId: string;
    try {
      productId = parseProductId(payload.product_id ?? null);
    } catch (error) {
      return errorResponse('VALIDATION_ERROR', 'ID de producto inválido', 400);
    }
    const product = await getProduct(prisma, productId);
    if (!product) {
      return errorResponse('NOT_FOUND', 'Producto no encontrado', 404);
    }

    let startDate: Date | null = null;
    let endDate: Date | null = null;
    let stockStatus: string | null = null;
    let stockQuantity: number | null = null;
    let price: Prisma.Decimal | null = null;
    let horaInicio: string | null = null;
    let horaFin: string | null = null;

    try {
      if (Object.prototype.hasOwnProperty.call(payload, 'start_date')) {
        startDate = parseDateInput(payload.start_date ?? null);
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'end_date')) {
        endDate = parseDateInput(payload.end_date ?? null);
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'stock_status')) {
        stockStatus = parseStockStatus(payload.stock_status ?? null);
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'stock_quantity')) {
        stockQuantity = parseStockQuantity(payload.stock_quantity ?? null);
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'price')) {
        price = parsePrice(payload.price ?? null);
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'hora_inicio')) {
        horaInicio = parseTimeInput(payload.hora_inicio ?? null);
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'hora_fin')) {
        horaFin = parseTimeInput(payload.hora_fin ?? null);
      }
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case 'INVALID_DATE':
            return errorResponse('VALIDATION_ERROR', 'Fecha inválida', 400);
          case 'INVALID_STOCK_STATUS':
            return errorResponse('VALIDATION_ERROR', 'Estado de stock inválido', 400);
          case 'INVALID_STOCK_QUANTITY':
            return errorResponse('VALIDATION_ERROR', 'Cantidad de stock inválida', 400);
          case 'INVALID_PRICE':
            return errorResponse('VALIDATION_ERROR', 'Precio inválido', 400);
          case 'INVALID_TIME':
            return errorResponse('VALIDATION_ERROR', 'Hora inválida (usa el formato HH:MM)', 400);
          default:
            break;
        }
      }
      return errorResponse('VALIDATION_ERROR', 'Datos inválidos', 400);
    }

    if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
      return errorResponse('VALIDATION_ERROR', 'La fecha fin no puede ser anterior a la fecha inicio', 400);
    }

    const timestamp = new Date();
    const data: Prisma.productsUpdateInput = { updated_at: timestamp };

    if (Object.prototype.hasOwnProperty.call(payload, 'start_date')) {
      data.default_variant_start = startDate;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'end_date')) {
      data.default_variant_end = endDate;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'stock_status')) {
      data.default_variant_stock_status = stockStatus;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'stock_quantity')) {
      data.default_variant_stock_quantity = stockQuantity;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'price')) {
      data.default_variant_price = price;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'hora_inicio')) {
      data.hora_inicio = horaInicio;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'hora_fin')) {
      data.hora_fin = horaFin;
    }

    const updated = await prisma.products.update({
      where: { id: productId },
      data,
      select: {
        id: true,
        default_variant_start: true,
        default_variant_end: true,
        default_variant_stock_status: true,
        default_variant_stock_quantity: true,
        default_variant_price: true,
        hora_inicio: true,
        hora_fin: true,
      },
    });

    return successResponse({ ok: true, product: normalizeDefaults(updated) });
  } catch (error) {
    console.error('[product-variant-settings] handler error', error);
    return errorResponse('UNEXPECTED_ERROR', 'Se ha producido un error inesperado', 500);
  }
};
