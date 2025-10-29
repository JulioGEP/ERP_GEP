import { Prisma } from '@prisma/client';
import { Decimal, PrismaClientKnownRequestError, PrismaClientUnknownRequestError } from '@prisma/client/runtime/library';

import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import { formatTimeFromDb, parseHHMMToDate } from './_shared/time';
import { toMadridISOString } from './_shared/timezone';
import { mapApiStockStatusToDbValue, mapDbStockStatusToApiValue } from './_shared/variant-defaults';

let variantDateColumnsSupported: boolean | null = null;

const VARIANT_DATE_COLUMN_PATTERNS = [/default_variant_(start|end)/i, /variant_(start|end)/i];

type ProductDefaultsRecord = {
  id: string;
  default_variant_start?: Date | string | null;
  default_variant_end?: Date | string | null;
  default_variant_stock_status?: string | null;
  default_variant_stock_quantity?: number | null;
  default_variant_price?: Decimal | string | null;
  hora_inicio?: Date | string | null;
  hora_fin?: Date | string | null;
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
    default_variant_start: toMadridISOString(record.default_variant_start ?? null),
    default_variant_end: toMadridISOString(record.default_variant_end ?? null),
    default_variant_stock_status: mapDbStockStatusToApiValue(record.default_variant_stock_status),
    default_variant_stock_quantity:
      record.default_variant_stock_quantity === undefined
        ? null
        : record.default_variant_stock_quantity ?? null,
    default_variant_price:
      record.default_variant_price == null
        ? null
        : typeof record.default_variant_price === 'string'
          ? record.default_variant_price
          : record.default_variant_price.toString(),
    hora_inicio: formatTimeFromDb(record.hora_inicio),
    hora_fin: formatTimeFromDb(record.hora_fin),
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
  } catch {
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

function parsePrice(value: unknown): Decimal | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const normalized = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(normalized)) {
    throw new Error('INVALID_PRICE');
  }
  return new Decimal(normalized.toString());
}

function parseProductId(value: unknown): string {
  if (value === null || value === undefined) {
    throw new Error('INVALID_PRODUCT_ID');
  }

  const normalized =
    typeof value === 'string'
      ? value
      : typeof value === 'number'
        ? value.toString()
        : '';

  const trimmed = normalized.trim();

  if (!trimmed) {
    throw new Error('INVALID_PRODUCT_ID');
  }

  return trimmed;
}

function parseTimeInput(value: unknown): Date | null {
  try {
    return parseHHMMToDate(value);
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_TIME') {
      throw error;
    }

    throw new Error('INVALID_TIME');
  }
}

function isMissingVariantDateColumns(error: unknown): boolean {
  if (error instanceof PrismaClientKnownRequestError) {
    return error.code === 'P2021';
  }

  if (error instanceof PrismaClientUnknownRequestError) {
    return VARIANT_DATE_COLUMN_PATTERNS.some((pattern) => pattern.test((error as Error).message));
  }

  if (error instanceof Error) {
    return VARIANT_DATE_COLUMN_PATTERNS.some((pattern) => pattern.test(error.message));
  }

  return false;
}

// NOTA: evitamos tipos de Prisma generados aquí; devolvemos un objeto literal “select” válido
function buildProductSelect(includeVariantDates: boolean) /* : any */ {
  if (includeVariantDates) {
    return {
      id: true,
      default_variant_start: true,
      default_variant_end: true,
      default_variant_stock_status: true,
      default_variant_stock_quantity: true,
      default_variant_price: true,
      hora_inicio: true,
      hora_fin: true,
    } as const;
  }

  return {
    id: true,
    default_variant_stock_status: true,
    default_variant_stock_quantity: true,
    default_variant_price: true,
    hora_inicio: true,
    hora_fin: true,
  } as const;
}

async function getProduct(prisma: ReturnType<typeof getPrisma>, productId: string) {
  const includeVariantDates = variantDateColumnsSupported !== false;

  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: buildProductSelect(includeVariantDates) as any,
    });

    if (includeVariantDates && variantDateColumnsSupported !== false) {
      variantDateColumnsSupported = true;
    }

    return product;
  } catch (error) {
    if (!includeVariantDates || !isMissingVariantDateColumns(error)) {
      throw error;
    }

    variantDateColumnsSupported = false;
    console.warn('[product-variant-settings] Variant date columns not available, falling back', { error });

    return prisma.product.findUnique({
      where: { id: productId },
      select: buildProductSelect(false) as any,
    });
  }
}

function buildUpdateData(params: {
  timestamp: Date;
  includeVariantDates: boolean;
  hasStartDate: boolean;
  hasEndDate: boolean;
  hasStockStatus: boolean;
  hasStockQuantity: boolean;
  hasPrice: boolean;
  hasHoraInicio: boolean;
  hasHoraFin: boolean;
  startDate: Date | null;
  endDate: Date | null;
  stockStatus: string | null;
  stockQuantity: number | null;
  price: Decimal | null;
  horaInicio: Date | null;
  horaFin: Date | null;
}) /* : any */ {
  const {
    timestamp,
    includeVariantDates,
    hasStartDate,
    hasEndDate,
    hasStockStatus,
    hasStockQuantity,
    hasPrice,
    hasHoraInicio,
    hasHoraFin,
    startDate,
    endDate,
    stockStatus,
    stockQuantity,
    price,
    horaInicio,
    horaFin,
  } = params;

  const data: Record<string, unknown> = { updated_at: timestamp };

  if (includeVariantDates) {
    if (hasStartDate) {
      data.default_variant_start = startDate;
    }
    if (hasEndDate) {
      data.default_variant_end = endDate;
    }
  }

  if (hasStockStatus) {
    data.default_variant_stock_status = stockStatus;
  }
  if (hasStockQuantity) {
    data.default_variant_stock_quantity = stockQuantity;
  }
  if (hasPrice) {
    data.default_variant_price = price;
  }
  if (hasHoraInicio) {
    data.hora_inicio = horaInicio ?? null;
  }
  if (hasHoraFin) {
    data.hora_fin = horaFin ?? null;
  }

  return data;
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
      return successResponse({ ok: true, product: normalizeDefaults(product as unknown as ProductDefaultsRecord) });
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
    let price: Decimal | null = null;
    let horaInicio: Date | null = null;
    let horaFin: Date | null = null;

    const hasStartDate = Object.prototype.hasOwnProperty.call(payload, 'start_date');
    const hasEndDate = Object.prototype.hasOwnProperty.call(payload, 'end_date');
    const hasStockStatus = Object.prototype.hasOwnProperty.call(payload, 'stock_status');
    const hasStockQuantity = Object.prototype.hasOwnProperty.call(payload, 'stock_quantity');
    const hasPrice = Object.prototype.hasOwnProperty.call(payload, 'price');
    const hasHoraInicio = Object.prototype.hasOwnProperty.call(payload, 'hora_inicio');
    const hasHoraFin = Object.prototype.hasOwnProperty.call(payload, 'hora_fin');

    try {
      if (hasStartDate) {
        startDate = parseDateInput(payload.start_date ?? null);
      }
      if (hasEndDate) {
        endDate = parseDateInput(payload.end_date ?? null);
      }
      if (hasStockStatus) {
        stockStatus = parseStockStatus(payload.stock_status ?? null);
      }
      if (hasStockQuantity) {
        stockQuantity = parseStockQuantity(payload.stock_quantity ?? null);
      }
      if (hasPrice) {
        price = parsePrice(payload.price ?? null);
      }
      if (hasHoraInicio) {
        horaInicio = parseTimeInput(payload.hora_inicio ?? null);
      }
      if (hasHoraFin) {
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
    const includeVariantDates = variantDateColumnsSupported !== false;
    const data = buildUpdateData({
      timestamp,
      includeVariantDates,
      hasStartDate,
      hasEndDate,
      hasStockStatus,
      hasStockQuantity,
      hasPrice,
      hasHoraInicio,
      hasHoraFin,
      startDate,
      endDate,
      stockStatus,
      stockQuantity,
      price,
      horaInicio,
      horaFin,
    });

    try {
      const updated = await prisma.product.update({
        where: { id: productId },
        data: data as any,
        select: buildProductSelect(includeVariantDates) as any,
      });

      if (includeVariantDates && variantDateColumnsSupported !== false) {
        variantDateColumnsSupported = true;
      }

      return successResponse({ ok: true, product: normalizeDefaults(updated as unknown as ProductDefaultsRecord) });
    } catch (error) {
      if (!includeVariantDates || !isMissingVariantDateColumns(error)) {
        throw error;
      }

      variantDateColumnsSupported = false;
      console.warn('[product-variant-settings] Update fallback without variant date columns', { error });

      const fallbackData = buildUpdateData({
        timestamp,
        includeVariantDates: false,
        hasStartDate,
        hasEndDate,
        hasStockStatus,
        hasStockQuantity,
        hasPrice,
        hasHoraInicio,
        hasHoraFin,
        startDate,
        endDate,
        stockStatus,
        stockQuantity,
        price,
        horaInicio,
        horaFin,
      });

      const updated = await prisma.product.update({
        where: { id: productId },
        data: fallbackData as any,
        select: buildProductSelect(false) as any,
      });

      return successResponse({ ok: true, product: normalizeDefaults(updated as unknown as ProductDefaultsRecord) });
    }
  } catch (error) {
    console.error('[product-variant-settings] handler error', error);
    return errorResponse('UNEXPECTED_ERROR', 'Se ha producido un error inesperado', 500);
  }
};
