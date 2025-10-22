// backend/functions/woo_courses.ts
import type { Prisma } from '@prisma/client';

import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';

type Event = {
  httpMethod: string;
  queryStringParameters?: Record<string, string | undefined> | null;
};

type WooErrorBody = {
  message?: string;
};

const WOO_BASE = (process.env.WOO_BASE_URL || '').replace(/\/$/, '');
const WOO_KEY = process.env.WOO_KEY || '';
const WOO_SECRET = process.env.WOO_SECRET || '';

function ensureConfigured() {
  if (!WOO_BASE || !WOO_KEY || !WOO_SECRET) {
    throw new Error('WooCommerce env vars missing');
  }
}

function removeImageFields(input: any): any {
  if (Array.isArray(input)) {
    return input.map((item) => removeImageFields(item));
  }

  if (input && typeof input === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(input)) {
      if (key.toLowerCase().includes('image')) continue;
      result[key] = removeImageFields(value);
    }
    return result;
  }

  return input;
}

const ESSENTIAL_VARIATION_FIELDS = new Set([
  'id',
  'name',
  'status',
  'sku',
  'price',
  'regular_price',
  'sale_price',
  'manage_stock',
  'stock_quantity',
  'stock_status',
  'parent_id',
  'attributes',
  'date_created',
  'date_created_gmt',
  'date_modified',
  'date_modified_gmt',
]);

const ESSENTIAL_VARIATION_ATTRIBUTE_FIELDS = new Set(['id', 'name', 'option', 'slug']);

const VARIATIONS_RESOURCE_REGEX = /^products\/(\d+)\/variations\/?$/i;
const LOCATION_KEYWORDS = ['localizacion', 'ubicacion', 'sede'];
const DATE_KEYWORDS = ['fecha'];

type VariationAttribute = {
  id?: number;
  name?: string;
  option?: string;
  slug?: string;
};

type SanitizedVariation = {
  id?: number | string | bigint | null;
  name?: string | null;
  status?: string | null;
  price?: string | number | null;
  stock_quantity?: number | string | null;
  stock_status?: string | null;
  parent_id?: number | string | bigint | null;
  attributes?: VariationAttribute[];
  date_created?: string | null;
  date_created_gmt?: string | null;
  date_modified?: string | null;
  date_modified_gmt?: string | null;
};

type VariationStoreResult = {
  ok: boolean;
  count: number;
  parent_id: string | null;
  message: string;
};

function pickFields(input: Record<string, any>, allowedKeys: Set<string>) {
  const output: Record<string, any> = {};

  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      output[key] = input[key];
    }
  }

  return output;
}

function sanitizeVariationAttributes(attributes: unknown): unknown {
  if (!Array.isArray(attributes)) return [];

  return attributes
    .filter((attribute) => attribute && typeof attribute === 'object')
    .map((attribute) => pickFields(attribute as Record<string, any>, ESSENTIAL_VARIATION_ATTRIBUTE_FIELDS));
}

function sanitizeVariation(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;

  const variation = input as Record<string, any>;
  const sanitized = pickFields(variation, ESSENTIAL_VARIATION_FIELDS);

  if (Array.isArray(variation.attributes)) {
    sanitized.attributes = sanitizeVariationAttributes(variation.attributes);
  }

  return sanitized;
}

function isVariationsResource(resource: string): boolean {
  return VARIATIONS_RESOURCE_REGEX.test(resource);
}

function extractProductIdFromResource(resource: string): bigint | null {
  const match = resource.match(VARIATIONS_RESOURCE_REGEX);
  if (!match) return null;

  try {
    return BigInt(match[1]);
  } catch (error) {
    console.error('[woo_courses] invalid product id in resource', { resource, error });
    return null;
  }
}

function toNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function parseBigIntValue(value: unknown): bigint | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'bigint') return value;

  if (typeof value === 'number' && Number.isFinite(value)) {
    try {
      return BigInt(Math.trunc(value));
    } catch (error) {
      console.error('[woo_courses] invalid numeric bigint value', { value, error });
      return null;
    }
  }

  const text = String(value).trim();
  if (!text) return null;

  try {
    return BigInt(text);
  } catch (error) {
    console.error('[woo_courses] invalid bigint string value', { value, error });
    return null;
  }
}

function parseDecimalValue(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const text = typeof value === 'string' ? value.trim() : String(value);
  if (!text) return null;

  const numberValue = Number(text);
  if (!Number.isFinite(numberValue)) return null;
  return numberValue;
}

function parseIntegerValue(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);

  const text = String(value).trim();
  if (!text) return null;

  const numberValue = Number(text);
  if (!Number.isFinite(numberValue)) return null;

  return Math.trunc(numberValue);
}

function normalizeAttributeText(value: string | undefined | null): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function findAttributeOptionByKeywords(
  attributes: VariationAttribute[] | undefined,
  keywords: string[],
): string | null {
  if (!attributes?.length) return null;

  const normalizedKeywords = keywords.map((keyword) => normalizeAttributeText(keyword));

  for (const attribute of attributes) {
    const normalizedName = normalizeAttributeText(attribute?.name ?? attribute?.slug ?? null);
    if (!normalizedName) continue;

    const matches = normalizedKeywords.some((keyword) => normalizedName.includes(keyword));
    if (!matches) continue;

    const option = toNullableString(attribute?.option);
    if (option) return option;
  }

  return null;
}

function parseDateFromText(value: string | null): Date | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;

  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) return direct;

  const match = text.match(/^([0-3]?\d)[\/-]([0-3]?\d)[\/-](\d{2,4})$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) {
      year += year < 50 ? 2000 : 1900;
    }

    if (Number.isFinite(day) && Number.isFinite(month) && Number.isFinite(year)) {
      const result = new Date(Date.UTC(year, month - 1, day));
      if (!Number.isNaN(result.getTime())) return result;
    }
  }

  return null;
}

function resolveVariationDate(variation: SanitizedVariation): Date | null {
  const attributeDate = parseDateFromText(
    findAttributeOptionByKeywords(variation.attributes, DATE_KEYWORDS),
  );
  if (attributeDate) return attributeDate;

  const fallbackDates = [
    variation.date_modified_gmt,
    variation.date_modified,
    variation.date_created_gmt,
    variation.date_created,
  ];

  for (const candidate of fallbackDates) {
    const parsed = parseDateFromText(candidate ?? null);
    if (parsed) return parsed;
  }

  return null;
}

function mapVariationToCreateInput(
  variation: SanitizedVariation,
  defaultParentId: bigint,
  timestamp: Date,
): Prisma.variantsCreateManyInput | null {
  const idWoo = parseBigIntValue(variation.id);
  if (!idWoo) return null;

  const parentId = parseBigIntValue(variation.parent_id) ?? defaultParentId;
  const price = parseDecimalValue(variation.price);
  const stock = parseIntegerValue(variation.stock_quantity);
  const sede = findAttributeOptionByKeywords(variation.attributes, LOCATION_KEYWORDS);
  const date = resolveVariationDate(variation);

  return {
    id_woo: idWoo,
    name: toNullableString(variation.name),
    status: toNullableString(variation.status),
    price,
    stock,
    stock_status: toNullableString(variation.stock_status),
    sede,
    date,
    id_padre: parentId,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

async function storeProductVariations(
  resource: string,
  data: unknown,
): Promise<VariationStoreResult> {
  const parentId = extractProductIdFromResource(resource);
  if (!parentId) {
    return {
      ok: false,
      count: 0,
      parent_id: null,
      message: 'No se pudo determinar el ID del producto padre',
    };
  }

  if (!Array.isArray(data)) {
    return {
      ok: false,
      count: 0,
      parent_id: parentId.toString(),
      message: 'Formato de variaciones inválido en la respuesta de WooCommerce',
    };
  }

  const prisma = getPrisma();
  const product = await prisma.products.findUnique({ where: { id_woo: parentId } });

  if (!product) {
    return {
      ok: false,
      count: 0,
      parent_id: parentId.toString(),
      message: `Producto con id_woo ${parentId.toString()} no encontrado en la base de datos`,
    };
  }

  const timestamp = new Date();
  const records = (data as SanitizedVariation[])
    .map((variation) => mapVariationToCreateInput(variation, parentId, timestamp))
    .filter((record): record is Prisma.variantsCreateManyInput => record !== null);

  const insertedCount = await prisma.$transaction(async (tx) => {
    await tx.variants.deleteMany({ where: { id_padre: parentId } });

    if (!records.length) {
      return 0;
    }

    const result = await tx.variants.createMany({ data: records });
    return result.count;
  });

  const message = records.length
    ? `Se guardaron ${insertedCount} variaciones para el producto ${parentId.toString()}.`
    : `No se encontraron variaciones para el producto ${parentId.toString()}; se eliminaron las existentes.`;

  return {
    ok: true,
    count: insertedCount,
    parent_id: parentId.toString(),
    message,
  };
}

function sanitizeByResource(resource: string, data: unknown): unknown {
  const withoutImages = removeImageFields(data);
  const isVariationResource = /\/variations(\/|$)/.test(resource);

  if (!isVariationResource) {
    return withoutImages;
  }

  if (Array.isArray(withoutImages)) {
    return withoutImages.map((item) => sanitizeVariation(item));
  }

  return sanitizeVariation(withoutImages);
}

function buildWooUrl(resource: string, params: Record<string, string | undefined>) {
  const normalizedResource = resource.replace(/^\/+/, '');
  const baseUrl = `${WOO_BASE}/wp-json/wc/v3/${normalizedResource}`;
  const url = new URL(baseUrl);

  for (const [key, value] of Object.entries(params)) {
    if (!key || key === 'resource') continue;
    if (value === undefined || value === null) continue;
    url.searchParams.append(key, String(value));
  }

  return url;
}

async function fetchWooResource(resource: string, params: Record<string, string | undefined>) {
  ensureConfigured();

  const url = buildWooUrl(resource, params);
  const authToken = Buffer.from(`${WOO_KEY}:${WOO_SECRET}`).toString('base64');

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Basic ${authToken}`,
    },
  });

  const text = await response.text();
  let data: any = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      console.error('[woo_courses] invalid JSON response', { url: url.toString(), error });
      return errorResponse('INVALID_RESPONSE', 'Respuesta JSON inválida de WooCommerce', 502);
    }
  }

  if (!response.ok) {
    const message = (data as WooErrorBody)?.message || 'Error al consultar WooCommerce';
    return errorResponse('WOO_ERROR', message, response.status || 502);
  }

  const sanitized = sanitizeByResource(resource, data);
  let meta: { stored_variations: VariationStoreResult } | undefined;

  if (isVariationsResource(resource)) {
    try {
      const result = await storeProductVariations(resource, sanitized);
      meta = { stored_variations: result };
    } catch (error) {
      console.error('[woo_courses] error storing product variations', { resource, error });
      const parentId = extractProductIdFromResource(resource);
      meta = {
        stored_variations: {
          ok: false,
          count: 0,
          parent_id: parentId ? parentId.toString() : null,
          message: 'Error al guardar las variaciones en la base de datos',
        },
      };
    }
  }

  return successResponse({
    data: sanitized,
    status: response.status,
    ...(meta ? { meta } : {}),
  });
}

export const handler = async (event: Event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    if (event.httpMethod !== 'GET') {
      return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
    }

    const params = event.queryStringParameters || {};
    const resource = params.resource?.trim();

    if (!resource) {
      return errorResponse('VALIDATION_ERROR', 'Parámetro "resource" requerido', 400);
    }

    return await fetchWooResource(resource, params);
  } catch (error) {
    console.error('[woo_courses] handler error', error);
    return errorResponse('UNEXPECTED_ERROR', 'Se ha producido un error inesperado', 500);
  }
};
