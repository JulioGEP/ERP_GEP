// backend/functions/products-variants.ts

import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import {
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
  Decimal,
} from '@prisma/client/runtime/library';

import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { buildMadridDateTime, formatTimeFromDb } from './_shared/time';
import { toMadridISOString } from './_shared/timezone';
import {
  getVariantResourceColumnsSupport,
  isVariantResourceColumnError,
  setVariantResourceColumnsSupport,
} from './_shared/variant-resources';
import { mapDbStockStatusToApiValue } from './_shared/variant-defaults';

const ALWAYS_AVAILABLE_UNIT_IDS = new Set(['52377f13-05dd-4830-88aa-0f5c78bee750']);

type TimeParts = { hour: number; minute: number };

function toTrimmed(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function extractTimeParts(value: Date | string | null | undefined): TimeParts | null {
  const formatted = formatTimeFromDb(value);
  if (!formatted) return null;
  const match = formatted.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function buildDateTime(date: Date, time: TimeParts | null, fallback: TimeParts): Date {
  const parts = time ?? fallback;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return buildMadridDateTime({ year, month, day, hour: parts.hour, minute: parts.minute });
}

type DateRange = { start: Date; end: Date };

function normalizeDateRange(start: Date | null | undefined, end: Date | null | undefined): DateRange | null {
  const effectiveStart = start ?? end ?? null;
  const effectiveEnd = end ?? start ?? null;
  if (!effectiveStart || !effectiveEnd) return null;

  const startTime = effectiveStart.getTime();
  const endTime = effectiveEnd.getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null;
  if (endTime < startTime) return null;

  return {
    start: new Date(startTime),
    end: new Date(endTime),
  };
}

function computeVariantRange(
  variantDate: Date | string | null | undefined,
  productTimes: { hora_inicio: Date | string | null; hora_fin: Date | string | null },
): DateRange | null {
  if (!variantDate) return null;

  const parsedDate = new Date(variantDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const startTime = extractTimeParts(productTimes.hora_inicio);
  const endTime = extractTimeParts(productTimes.hora_fin);
  const fallbackStart: TimeParts = startTime ?? { hour: 9, minute: 0 };
  const fallbackEnd: TimeParts = endTime ?? (startTime ? { ...startTime } : { hour: 11, minute: 0 });

  const start = buildDateTime(parsedDate, startTime, fallbackStart);
  let end = buildDateTime(parsedDate, endTime, fallbackEnd);

  if (end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }

  return { start, end };
}

async function ensureVariantResourcesAvailable(
  prisma: PrismaClient,
  {
    excludeVariantId,
    trainerId,
    salaId,
    unidadId,
    range,
  }: {
    excludeVariantId?: string;
    trainerId: string | null;
    salaId: string | null;
    unidadId: string | null;
    range: DateRange | null;
  },
): Promise<ReturnType<typeof errorResponse> | null> {
  if (!range) return null;

  const normalizedTrainerId = trainerId ?? null;
  const normalizedSalaId = salaId ?? null;
  const normalizedUnidadId =
    unidadId && !ALWAYS_AVAILABLE_UNIT_IDS.has(unidadId) ? unidadId : null;

  if (!normalizedTrainerId && !normalizedSalaId && !normalizedUnidadId) return null;
  if (getVariantResourceColumnsSupport() === false) return null;

  // Tipos generados pueden variar; usamos `any` para compatibilidad con Prisma v5
  const sessionConditions: any[] = [];
  if (normalizedTrainerId) sessionConditions.push({ trainers: { some: { trainer_id: normalizedTrainerId } } });
  if (normalizedSalaId) sessionConditions.push({ sala_id: normalizedSalaId });
  if (normalizedUnidadId) sessionConditions.push({ unidades: { some: { unidad_id: normalizedUnidadId } } });

  if (sessionConditions.length) {
    const sessions = await prisma.sessions.findMany({
      where: { OR: sessionConditions as any },
      select: { fecha_inicio_utc: true, fecha_fin_utc: true },
    });

    const hasSessionConflict = sessions.some(
  (session: { fecha_inicio_utc: Date | null; fecha_fin_utc: Date | null }) => {
    const sessionRange = normalizeDateRange(session.fecha_inicio_utc, session.fecha_fin_utc);
    if (!sessionRange) return false;
    return (
      sessionRange.start.getTime() <= range.end.getTime() &&
      sessionRange.end.getTime() >= range.start.getTime()
    );
  },
);


    if (hasSessionConflict) {
      return errorResponse(
        'RESOURCE_UNAVAILABLE',
        'Algunos recursos ya están asignados en las fechas seleccionadas.',
        409,
      );
    }
  }

  const variantConditions: any[] = [];
  if (normalizedTrainerId) variantConditions.push({ trainer_id: normalizedTrainerId });
  if (normalizedSalaId) variantConditions.push({ sala_id: normalizedSalaId });
  if (normalizedUnidadId) variantConditions.push({ unidad_movil_id: normalizedUnidadId });

  if (!variantConditions.length) return null;

  let variants;
  try {
    variants = await prisma.variants.findMany({
      where: {
        ...(excludeVariantId ? { id: { not: excludeVariantId } } : {}),
        date: { not: null },
        OR: variantConditions as any,
      },
      select: {
        id: true,
        date: true,
        trainer_id: true,
        sala_id: true,
        unidad_movil_id: true,
        product: { select: { hora_inicio: true, hora_fin: true } },
      },
    });
    setVariantResourceColumnsSupport(true);
  } catch (error) {
    if (isVariantResourceColumnError(error)) {
      setVariantResourceColumnsSupport(false);
      console.warn(
        '[products-variants] skipping variant resource availability check (missing resource columns)',
        { error },
      );
      return null;
    }
    throw error;
  }

  const hasVariantConflict = variants.some(
  (variant: {
    date: Date | string | null;
    trainer_id: string | null;
    sala_id: string | null;
    unidad_movil_id: string | null;
    product?: { hora_inicio: Date | string | null; hora_fin: Date | string | null } | null;
  }) => {
    const otherRange = computeVariantRange(
      variant.date,
      variant.product ?? { hora_inicio: null, hora_fin: null },
    );
    if (!otherRange) return false;

    const overlaps =
      otherRange.start.getTime() <= range.end.getTime() &&
      otherRange.end.getTime() >= range.start.getTime();
    if (!overlaps) return false;

    const trainerConflict = normalizedTrainerId && variant.trainer_id === normalizedTrainerId;
    const salaConflict = normalizedSalaId && variant.sala_id === normalizedSalaId;
    const unidadConflict = normalizedUnidadId && variant.unidad_movil_id === normalizedUnidadId;

    return Boolean(trainerConflict || salaConflict || unidadConflict);
  },
);

  if (hasVariantConflict) {
    return errorResponse(
      'RESOURCE_UNAVAILABLE',
      'Algunos recursos ya están asignados en las fechas seleccionadas.',
      409,
    );
  }

  return null;
}

const WOO_BASE = (process.env.WOO_BASE_URL || '').replace(/\/$/, '');
const WOO_KEY = process.env.WOO_KEY || '';
const WOO_SECRET = process.env.WOO_SECRET || '';

type VariantDeletionResult = { success: boolean; message?: string };

type WooVariationAttribute = {
  id?: number;
  name?: string;
  option?: string;
  slug?: string;
};

function ensureWooConfigured() {
  if (!WOO_BASE || !WOO_KEY || !WOO_SECRET) throw new Error('WooCommerce configuration missing');
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
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
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
  trainer_id?: string | null;
  sala_id?: string | null;
  unidad_movil_id?: string | null;
};

type VariantWooUpdateInput = Pick<
  VariantUpdateInput,
  'price' | 'stock' | 'stock_status' | 'status' | 'sede' | 'date'
>;

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
  updates: VariantWooUpdateInput,
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
    const updatedAttributes = attributes.map((a) => ({ ...a }));

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

  if (!Object.keys(body).length) return;

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
    return { success: true, message: 'La variante no existe en WooCommerce, se eliminará localmente.' };
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
  id_padre: bigint;
  name: string | null;
  status: string | null;
  price: Decimal | string | null;
  stock: number | null;
  stock_status: string | null;
  sede: string | null;
  date: Date | string | null;
  trainer_id?: string | null;
  sala_id?: string | null;
  unidad_movil_id?: string | null;
  trainer?: { trainer_id: string; name: string | null; apellido: string | null } | null;
  sala?: { sala_id: string; name: string; sede: string | null } | null;
  unidad?: { unidad_id: string; name: string; matricula: string | null } | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

type ProductRecord = {
  id: string;
  id_pipe: string;
  id_woo: bigint | null;
  name: string | null;
  code: string | null;
  category: string | null;
  hora_inicio: Date | string | null;
  hora_fin: Date | string | null;
  default_variant_start: Date | string | null;
  default_variant_end: Date | string | null;
  default_variant_stock_status: string | null;
  default_variant_stock_quantity: number | null;
  default_variant_price: Decimal | string | null;
  variants: VariantRecord[];
};

type LegacyProductRecord = Omit<
  ProductRecord,
  'default_variant_start' | 'default_variant_end' | 'default_variant_stock_status' | 'default_variant_stock_quantity' | 'default_variant_price'
>;

let productsDefaultFieldsSupported: boolean | null = null;

const PRODUCT_DEFAULT_COLUMN_PATTERNS = [
  /default_variant_(start|end|stock_status|stock_quantity|price)/i,
  /variant_(start|end|stock_status|stock_quantity|price)/i,
];

function isPrismaErrorInstance(error: unknown, ctor: unknown): boolean {
  if (!ctor || typeof ctor !== 'function') return false;
  try {
    return error instanceof (ctor as new (...args: any[]) => Error);
  } catch {
    return false;
  }
}

function isMissingProductDefaultColumns(error: unknown): boolean {
  if (isPrismaErrorInstance(error, PrismaClientKnownRequestError)) {
    return (error as PrismaClientKnownRequestError).code === 'P2021';
  }
  if (isPrismaErrorInstance(error, PrismaClientUnknownRequestError)) {
    return PRODUCT_DEFAULT_COLUMN_PATTERNS.some((p) => p.test((error as Error).message));
  }
  if (error instanceof Error) {
    return PRODUCT_DEFAULT_COLUMN_PATTERNS.some((p) => p.test(error.message));
  }
  return false;
}

async function findProducts(prisma: PrismaClient): Promise<ProductRecord[]> {
  const baseWhere = { id_woo: { not: null }, variants: { some: {} } };

  const buildVariantSelect = (includeResources: boolean): any => {
    const base = {
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
      created_at: true,
      updated_at: true,
    };

    if (!includeResources) return base;

    return {
      ...base,
      trainer_id: true,
      sala_id: true,
      unidad_movil_id: true,
      trainer: { select: { trainer_id: true, name: true, apellido: true } },
      sala: { select: { sala_id: true, name: true, sede: true} },
      unidad: { select: { unidad_id: true, name: true, matricula: true } },
    };
  };

  const buildVariantsSelection = (includeResources: boolean) => ({
    orderBy: [{ date: 'asc' as const }, { name: 'asc' as const }],
    select: buildVariantSelect(includeResources),
  });

  const orderByName = [{ name: 'asc' as const }];

  const mapLegacyProducts = (products: LegacyProductRecord[]): ProductRecord[] =>
    products.map((p) => ({
      ...p,
      default_variant_start: null,
      default_variant_end: null,
      default_variant_stock_status: null,
      default_variant_stock_quantity: null,
      default_variant_price: null,
    }));

  let includeDefaults = productsDefaultFieldsSupported !== false;
  let includeVariantResources = getVariantResourceColumnsSupport() !== false;

  // Bucle de reintento con degradaciones controladas
  while (true) {
    const variantSelectionArgs = buildVariantsSelection(includeVariantResources);

    const select: Record<string, any> = includeDefaults
      ? {
          id: true,
          id_pipe: true,
          id_woo: true,
          name: true,
          code: true,
          category: true,
          hora_inicio: true,
          hora_fin: true,
          default_variant_start: true,
          default_variant_end: true,
          default_variant_stock_status: true,
          default_variant_stock_quantity: true,
          default_variant_price: true,
          variants: variantSelectionArgs,
        }
      : {
          id: true,
          id_pipe: true,
          id_woo: true,
          name: true,
          code: true,
          category: true,
          hora_inicio: true,
          hora_fin: true,
          variants: variantSelectionArgs,
        };

    try {
      const products = await prisma.products.findMany({
        where: baseWhere as any,
        select,
        orderBy: orderByName as any,
      });

      if (!includeDefaults) {
        if (includeVariantResources) setVariantResourceColumnsSupport(true);
        const legacy = products as unknown as LegacyProductRecord[];
        return mapLegacyProducts(legacy);
      }

      productsDefaultFieldsSupported = true;
      if (includeVariantResources) setVariantResourceColumnsSupport(true);

      return products as unknown as ProductRecord[];
    } catch (error) {
      if (includeDefaults && isMissingProductDefaultColumns(error)) {
        productsDefaultFieldsSupported = false;
        includeDefaults = false;
        console.warn(
          '[products-variants] falling back to legacy product query (missing default variant columns)',
          { error },
        );
        continue;
      }

      if (includeVariantResources && isVariantResourceColumnError(error)) {
        setVariantResourceColumnsSupport(false);
        includeVariantResources = false;
        console.warn(
          '[products-variants] falling back to variant query without resource columns',
          { error },
        );
        continue;
      }

      throw error;
    }
  }
}

function normalizeVariant(record: VariantRecord) {
  const price =
    record.price == null ? null : typeof record.price === 'string' ? record.price : record.price.toString();

  return {
    id: record.id,
    id_woo: record.id_woo?.toString(),
    id_padre: record.id_padre?.toString(),
    name: record.name ?? null,
    status: record.status ?? null,
    price,
    stock: record.stock ?? null,
    stock_status: record.stock_status ?? null,
    sede: record.sede ?? null,
    date: toMadridISOString(record.date),
    trainer_id: record.trainer_id ?? null,
    trainer: record.trainer
      ? { trainer_id: record.trainer.trainer_id, name: record.trainer.name ?? null, apellido: record.trainer.apellido ?? null }
      : null,
    sala_id: record.sala_id ?? null,
    sala: record.sala ? { sala_id: record.sala.sala_id, name: record.sala.name, sede: record.sala.sede ?? null } : null,
    unidad_movil_id: record.unidad_movil_id ?? null,
    unidad: record.unidad
      ? { unidad_id: record.unidad.unidad_id, name: record.unidad.name, matricula: record.unidad.matricula ?? null }
      : null,
    created_at: toMadridISOString(record.created_at),
    updated_at: toMadridISOString(record.updated_at),
  } as const;
}

function normalizeProduct(record: ProductRecord) {
  const defaultPrice =
    record.default_variant_price == null
      ? null
      : typeof record.default_variant_price === 'string'
        ? record.default_variant_price
        : record.default_variant_price.toString();

  return {
    id: record.id,
    id_pipe: record.id_pipe,
    id_woo: record.id_woo ? record.id_woo.toString() : null,
    name: record.name ?? null,
    code: record.code ?? null,
    category: record.category ?? null,
    hora_inicio: formatTimeFromDb(record.hora_inicio),
    hora_fin: formatTimeFromDb(record.hora_fin),
    default_variant_start: toMadridISOString(record.default_variant_start),
    default_variant_end: toMadridISOString(record.default_variant_end),
    default_variant_stock_status: mapDbStockStatusToApiValue(record.default_variant_stock_status),
    default_variant_stock_quantity: record.default_variant_stock_quantity ?? null,
    default_variant_price: defaultPrice,
    variants: record.variants.map(normalizeVariant),
  } as const;
}

export const handler = createHttpHandler<any>(async (request) => {
  const method = request.method;
  const prisma = getPrisma();

  if (method === 'PATCH') {
    const variantId = parseVariantIdFromPath(request.path || '');
    if (!variantId) return errorResponse('VALIDATION_ERROR', 'ID de variante requerido', 400);
    if (!request.rawBody) return errorResponse('VALIDATION_ERROR', 'Cuerpo de la petición requerido', 400);

    const payload = request.body && typeof request.body === 'object' ? (request.body as any) : {};
    const updates: VariantUpdateInput = {};

    if (Object.prototype.hasOwnProperty.call(payload, 'price')) {
      const rawPrice = payload.price;
      if (rawPrice == null || rawPrice === '') {
        updates.price = null;
      } else {
        const text = String(rawPrice).replace(',', '.').trim();
        if (!text || Number.isNaN(Number(text))) return errorResponse('VALIDATION_ERROR', 'Precio inválido', 400);
        updates.price = text;
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'stock')) {
      const rawStock = payload.stock;
      if (rawStock == null || rawStock === '') {
        updates.stock = null;
      } else {
        const numberValue = Number(rawStock);
        if (!Number.isFinite(numberValue)) return errorResponse('VALIDATION_ERROR', 'Stock inválido', 400);
        updates.stock = Math.trunc(numberValue);
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'stock_status')) {
      updates.stock_status =
        payload.stock_status == null || payload.stock_status === '' ? 'instock' : String(payload.stock_status).trim();
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
      if (payload.status == null || payload.status === '') {
        updates.status = 'publish';
      } else {
        const text = String(payload.status).trim().toLowerCase();
        if (text !== 'publish' && text !== 'private')
          return errorResponse('VALIDATION_ERROR', 'Estado de publicación inválido', 400);
        updates.status = text;
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'sede')) {
      updates.sede = payload.sede == null ? null : String(payload.sede).trim();
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'date')) {
      if (payload.date == null || payload.date === '') {
        updates.date = null;
      } else {
        const text = String(payload.date).trim();
        const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) {
          const [, y, m, d] = isoMatch;
          const year = Number.parseInt(y, 10);
          const month = Number.parseInt(m, 10);
          const day = Number.parseInt(d, 10);
          if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || month < 1 || month > 12 || day < 1 || day > 31) {
            return errorResponse('VALIDATION_ERROR', 'Fecha inválida', 400);
          }
          updates.date = new Date(Date.UTC(year, month - 1, day));
        } else {
          const parsed = new Date(text);
          if (Number.isNaN(parsed.getTime())) return errorResponse('VALIDATION_ERROR', 'Fecha inválida', 400);
          updates.date = parsed;
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'trainer_id')) updates.trainer_id = toTrimmed(payload.trainer_id);
    if (Object.prototype.hasOwnProperty.call(payload, 'sala_id')) updates.sala_id = toTrimmed(payload.sala_id);
    if (Object.prototype.hasOwnProperty.call(payload, 'unidad_movil_id'))
      updates.unidad_movil_id = toTrimmed(payload.unidad_movil_id);

    if (!Object.keys(updates).length) return errorResponse('VALIDATION_ERROR', 'No se proporcionaron cambios', 400);

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
        trainer_id: true,
        sala_id: true,
        unidad_movil_id: true,
        product: { select: { hora_inicio: true, hora_fin: true } },
      },
    });
    if (!existing) return errorResponse('NOT_FOUND', 'Variante no encontrada', 404);

    const nextTrainerId = Object.prototype.hasOwnProperty.call(updates, 'trainer_id') ? updates.trainer_id ?? null : existing.trainer_id ?? null;
    const nextSalaId    = Object.prototype.hasOwnProperty.call(updates, 'sala_id')    ? updates.sala_id ?? null    : existing.sala_id ?? null;
    const nextUnidadId  = Object.prototype.hasOwnProperty.call(updates, 'unidad_movil_id') ? updates.unidad_movil_id ?? null : existing.unidad_movil_id ?? null;
    const nextSede      = Object.prototype.hasOwnProperty.call(updates, 'sede') ? updates.sede ?? null : existing.sede ?? null;
    const nextDate      = Object.prototype.hasOwnProperty.call(updates, 'date') ? updates.date ?? null : existing.date ?? null;

    if (nextSede && nextSalaId && nextSede.trim().toLowerCase() === 'sabadell') {
      const room = await prisma.salas.findUnique({ where: { sala_id: nextSalaId }, select: { sala_id: true, sede: true } });
      if (!room) return errorResponse('VALIDATION_ERROR', 'La sala seleccionada no existe', 400);
      if ((room.sede ?? '').trim().toLowerCase() !== 'gep sabadell') {
        return errorResponse('VALIDATION_ERROR', 'La sala seleccionada no pertenece a GEP Sabadell.', 400);
      }
    }

    const productTimes = existing.product ?? { hora_inicio: null, hora_fin: null };
    const variantRange = computeVariantRange(nextDate, productTimes);

    const availabilityError = await ensureVariantResourcesAvailable(prisma, {
      excludeVariantId: existing.id,
      trainerId: nextTrainerId,
      salaId: nextSalaId,
      unidadId: nextUnidadId,
      range: variantRange,
    });
    if (availabilityError) return availabilityError;

    const wooUpdates: VariantWooUpdateInput = {};
    if ('price' in updates) wooUpdates.price = updates.price ?? null;
    if ('stock' in updates) wooUpdates.stock = updates.stock ?? null;
    if ('stock_status' in updates) wooUpdates.stock_status = updates.stock_status ?? null;
    if ('status' in updates) wooUpdates.status = updates.status ?? null;
    if ('sede' in updates) wooUpdates.sede = updates.sede ?? null;
    if ('date' in updates) wooUpdates.date = updates.date ?? null;

    if (Object.keys(wooUpdates).length) {
      try {
        await updateVariantInWooCommerce(existing.id_padre, existing.id_woo, wooUpdates);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo actualizar la variante en WooCommerce';
        return errorResponse('WOO_UPDATE_ERROR', message, 502);
      }
    }

    const timestamp = new Date();
    const data: any = { updated_at: timestamp };
    if ('price' in updates) data.price = updates.price == null ? null : new Decimal(updates.price);
    if ('stock' in updates) data.stock = updates.stock ?? null;
    if ('stock_status' in updates) data.stock_status = updates.stock_status ?? null;
    if ('status' in updates) data.status = updates.status ?? null;
    if ('sede' in updates) data.sede = updates.sede ?? null;
    if ('date' in updates) data.date = updates.date ?? null;
    if ('trainer_id' in updates) data.trainer_id = updates.trainer_id ?? null;
    if ('sala_id' in updates) data.sala_id = updates.sala_id ?? null;
    if ('unidad_movil_id' in updates) data.unidad_movil_id = updates.unidad_movil_id ?? null;

    await prisma.variants.update({ where: { id: variantId }, data });

    const refreshed = await prisma.variants.findUnique({
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
        trainer_id: true,
        sala_id: true,
        unidad_movil_id: true,
        trainer: { select: { trainer_id: true, name: true, apellido: true } },
        sala: { select: { sala_id: true, name: true, sede: true } },
        unidad: { select: { unidad_id: true, name: true, matricula: true } },
        created_at: true,
        updated_at: true,
      },
    });

    return successResponse({ ok: true, variant: refreshed ? normalizeVariant(refreshed) : null });
  }

  if (method === 'DELETE') {
    const variantId = parseVariantIdFromPath(request.path || '');
    if (!variantId) return errorResponse('VALIDATION_ERROR', 'ID de variante requerido', 400);

    const variant = await prisma.variants.findUnique({
      where: { id: variantId },
      select: { id: true, id_padre: true, id_woo: true },
    });
    if (!variant) return errorResponse('NOT_FOUND', 'Variante no encontrada', 404);

    let wooMessage: string | undefined;
    try {
      const result = await deleteVariantFromWooCommerce(variant.id_padre, variant.id_woo);
      wooMessage = result.message;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo eliminar la variante en WooCommerce';
      return errorResponse('WOO_DELETE_ERROR', message, 502);
    }

    await prisma.variants.delete({ where: { id: variantId } });
    return successResponse({ ok: true, message: wooMessage ?? 'Variante eliminada correctamente' });
  }

  if (method !== 'GET') return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);

  const productsRaw = await findProducts(prisma);
  const products = productsRaw.map(normalizeProduct);
  return successResponse({ products });
});
