// backend/functions/woo_courses.ts
import type { Prisma } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';

import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';

type Event = {
  httpMethod: string;
};

type WooErrorBody = {
  message?: string;
};

type ProductWithWooId = {
  id: string;
  id_woo: bigint;
  name: string | null;
};

type VariationsSyncChange = {
  id_woo: string;
  name: string | null;
  changes?: string[];
};

type ProductSyncReport = {
  productId: string;
  productWooId: string;
  productName: string | null;
  fetchedVariations: number;
  validVariations: number;
  skippedVariations: number;
  added: VariationsSyncChange[];
  updated: VariationsSyncChange[];
  removed: VariationsSyncChange[];
  error?: string;
};

type SyncTotals = {
  added: number;
  updated: number;
  removed: number;
};

type SyncLogEntry = {
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  productWooId?: string | null;
  productName?: string | null;
};

type SyncSummary = {
  totalProducts: number;
  processedProducts: number;
  failedProducts: number;
  totals: SyncTotals;
  products: ProductSyncReport[];
};

type SyncResult = {
  ok: true;
  logs: SyncLogEntry[];
  summary: SyncSummary;
};

const WOO_BASE = (process.env.WOO_BASE_URL || '').replace(/\/$/, '');
const WOO_KEY = process.env.WOO_KEY || '';
const WOO_SECRET = process.env.WOO_SECRET || '';

const DEFAULT_SYNC_CONCURRENCY = 3;

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
  'meta_data',
]);

const ESSENTIAL_VARIATION_ATTRIBUTE_FIELDS = new Set(['id', 'name', 'option', 'slug']);
const ESSENTIAL_VARIATION_META_FIELDS = new Set(['key', 'value']);

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
  meta_data?: VariationMetaData[];
};

type VariationPersistence = {
  idWoo: bigint;
  name: string | null;
  status: string | null;
  price: number | null;
  stock: number | null;
  stock_status: string | null;
  sede: string | null;
  date: Date | null;
};

type VariationMetaData = {
  key?: string | null;
  value?: unknown;
};

function ensureConfigured() {
  if (!WOO_BASE || !WOO_KEY || !WOO_SECRET) {
    throw new Error('WooCommerce env vars missing');
  }
}

function resolveSyncConcurrency(): number {
  const raw = process.env.WOO_SYNC_CONCURRENCY;
  if (!raw) return DEFAULT_SYNC_CONCURRENCY;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SYNC_CONCURRENCY;

  return Math.min(parsed, 6);
}

function removeImageFields(input: any): any {
  if (Array.isArray(input)) return input.map((item) => removeImageFields(item));

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

function pickFields(input: Record<string, any>, allowedKeys: Set<string>) {
  const output: Record<string, any> = {};
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      output[key] = input[key];
    }
  }
  return output;
}

function sanitizeVariationAttributes(attributes: unknown): VariationAttribute[] {
  if (!Array.isArray(attributes)) return [];
  return attributes
    .filter((attribute) => attribute && typeof attribute === 'object')
    .map((attribute) =>
      pickFields(attribute as Record<string, any>, ESSENTIAL_VARIATION_ATTRIBUTE_FIELDS),
    )
    .map((attribute) => attribute as VariationAttribute);
}

function sanitizeVariationMetaData(meta: unknown): VariationMetaData[] {
  if (!Array.isArray(meta)) return [];
  return meta
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => pickFields(entry as Record<string, any>, ESSENTIAL_VARIATION_META_FIELDS))
    .map((entry) => entry as VariationMetaData);
}

function sanitizeVariation(input: unknown): SanitizedVariation {
  if (!input || typeof input !== 'object') return {};
  const variation = input as Record<string, any>;
  const sanitized = pickFields(variation, ESSENTIAL_VARIATION_FIELDS) as SanitizedVariation;
  sanitized.attributes = sanitizeVariationAttributes(variation.attributes);
  sanitized.meta_data = sanitizeVariationMetaData(variation.meta_data);
  return sanitized;
}

function sanitizeVariationList(data: unknown[]): SanitizedVariation[] {
  return data
    .map((item) => sanitizeVariation(removeImageFields(item)))
    .filter((item): item is SanitizedVariation => item !== null && typeof item === 'object');
}

function normalizeAttributeText(value: string | undefined | null): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
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

function parseDateFromParts(year: number, month: number, day: number): Date | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function parseDateFromText(value: string | null): Date | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;

  const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, yearText, monthText, dayText] = isoMatch;
    const year = Number.parseInt(yearText, 10);
    const month = Number.parseInt(monthText, 10);
    const day = Number.parseInt(dayText, 10);
    const parsed = parseDateFromParts(year, month, day);
    if (parsed) return parsed;
  }

  const match = text.match(/([0-3]?\d)[\/-]([0-3]?\d)[\/-](\d{2,4})/);
  if (match) {
    const day = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    let year = Number.parseInt(match[3], 10);
    if (year < 100) year += year < 50 ? 2000 : 1900;

    const parsed = parseDateFromParts(year, month, day);
    if (parsed) return parsed;
  }

  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) return direct;

  return null;
}

function resolveVariationDate(variation: SanitizedVariation): Date | null {
  const attributeDate = parseDateFromText(
    findAttributeOptionByKeywords(variation.attributes, DATE_KEYWORDS),
  );
  if (attributeDate) return attributeDate;

  const metaDate = extractDateFromMetaData(variation.meta_data);
  if (metaDate) return metaDate;

  const nameDate = parseDateFromText(toNullableString(variation.name));
  if (nameDate) return nameDate;

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

function mapVariationToPersistence(variation: SanitizedVariation): VariationPersistence | null {
  const idWoo = parseBigIntValue(variation.id);
  if (!idWoo) return null;

  const price = parseDecimalValue(variation.price);
  const stock = parseIntegerValue(variation.stock_quantity);
  const sede = findAttributeOptionByKeywords(variation.attributes, LOCATION_KEYWORDS);
  const date = resolveVariationDate(variation);

  return {
    idWoo,
    name: toNullableString(variation.name),
    status: toNullableString(variation.status),
    price,
    stock,
    stock_status: toNullableString(variation.stock_status),
    sede,
    date,
  };
}

function extractDateFromMetaData(meta: VariationMetaData[] | undefined): Date | null {
  if (!meta?.length) return null;

  for (const entry of meta) {
    const key = typeof entry?.key === 'string' ? entry.key.trim().toLowerCase() : '';
    if (!key) continue;

    if (key === 'start_date' || key === 'fecha' || key === '_event_date') {
      const value = toNullableString(entry?.value);
      const parsed = parseDateFromText(value);
      if (parsed) return parsed;
    }
  }

  return null;
}

function decimalToNumber(value: Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  try {
    return Number(value as unknown as Decimal);
  } catch (error) {
    console.error('[woo_courses] invalid decimal value', { value, error });
    return null;
  }
}

function numbersEqual(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(a - b) < 1e-6;
}

function integersEqual(a: number | null | undefined, b: number | null): boolean {
  if (a === null || a === undefined) return b === null;
  if (b === null || b === undefined) return false;
  return a === b;
}

function stringsEqual(a: string | null | undefined, b: string | null): boolean {
  const left = a ?? null;
  const right = b ?? null;
  return left === right;
}

function datesEqual(a: Date | null | undefined, b: Date | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.getTime() === b.getTime();
}

function buildWooUrl(resource: string, params: Record<string, string | number | undefined>) {
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

async function fetchWooVariations(productId: bigint): Promise<SanitizedVariation[]> {
  ensureConfigured();

  const resource = `products/${productId.toString()}/variations`;
  const perPage = 100;
  const all: SanitizedVariation[] = [];
  const authToken = Buffer.from(`${WOO_KEY}:${WOO_SECRET}`).toString('base64');

  for (let page = 1; ; page += 1) {
    const url = buildWooUrl(resource, { per_page: perPage, page });
    let response: Response;

    try {
      response = await fetch(url.toString(), {
        headers: {
          Authorization: `Basic ${authToken}`,
        },
      });
    } catch (error) {
      console.error('[woo_courses] network error while fetching variations', {
        productId: productId.toString(),
        error,
      });
      throw new Error('No se pudo conectar con WooCommerce');
    }

    const text = await response.text();
    let data: unknown = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        console.error('[woo_courses] invalid JSON response', { url: url.toString(), error });
        throw new Error('Respuesta JSON inválida de WooCommerce');
      }
    }

    if (!response.ok) {
      const message =
        data && typeof data === 'object' && typeof (data as WooErrorBody).message === 'string'
          ? (data as WooErrorBody).message!
          : `Error al consultar WooCommerce (status ${response.status})`;
      throw new Error(message);
    }

    const rawArray = Array.isArray(data) ? data : [];
    const sanitized = sanitizeVariationList(rawArray);
    all.push(...sanitized);

    if (!Array.isArray(data) || rawArray.length < perPage) break;
  }

  return all;
}

type ExistingVariant = {
  id: string;
  id_woo: bigint;
  name: string | null;
  status: string | null;
  price: Decimal | number | null;
  stock: number | null;
  stock_status: string | null;
  sede: string | null;
  date: Date | null;
};

function buildUpdateData(
  existing: ExistingVariant,
  incoming: VariationPersistence,
  timestamp: Date,
): { data: Record<string, any>; changes: string[] } {
  const data: Record<string, any> = {};
  const changes: string[] = [];

  if (!stringsEqual(existing.name, incoming.name)) {
    data.name = incoming.name;
    changes.push('name');
  }

  if (!stringsEqual(existing.status, incoming.status)) {
    data.status = incoming.status;
    changes.push('status');
  }

  if (!numbersEqual(decimalToNumber(existing.price), incoming.price)) {
    data.price = incoming.price;
    changes.push('price');
  }

  if (!integersEqual(existing.stock, incoming.stock)) {
    data.stock = incoming.stock;
    changes.push('stock');
  }

  if (!stringsEqual(existing.stock_status, incoming.stock_status)) {
    data.stock_status = incoming.stock_status;
    changes.push('stock_status');
  }

  if (!stringsEqual(existing.sede, incoming.sede)) {
    data.sede = incoming.sede;
    changes.push('sede');
  }

  if (!datesEqual(existing.date, incoming.date)) {
    data.date = incoming.date;
    changes.push('date');
  }

  if (changes.length > 0) {
    data.updated_at = timestamp;
  }

  return { data, changes };
}

async function syncProductVariations(
  prisma: ReturnType<typeof getPrisma>,
  product: ProductWithWooId,
  variations: SanitizedVariation[],
): Promise<{ summary: ProductSyncReport; totals: SyncTotals; logs: SyncLogEntry[] }> {
  const logs: SyncLogEntry[] = [];
  const productWooId = product.id_woo.toString();

  const uniqueVariations = new Map<string, VariationPersistence>();
  let skipped = 0;

  for (const variation of variations) {
    const mapped = mapVariationToPersistence(variation);
    if (!mapped) {
      skipped += 1;
      continue;
    }

    const key = mapped.idWoo.toString();
    if (uniqueVariations.has(key)) {
      skipped += 1;
      continue;
    }

    uniqueVariations.set(key, mapped);
  }

  const persistable = Array.from(uniqueVariations.values());
  const timestamp = new Date();

  const transactionResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const client = tx;

    const existing = (await client.variants.findMany({
      where: { id_padre: product.id_woo },
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
      },
    })) as unknown as ExistingVariant[];

    const existingMap = new Map(existing.map((variant) => [variant.id_woo.toString(), variant]));
    const processedIds = new Set<string>();

    const added: VariationsSyncChange[] = [];
    const updated: VariationsSyncChange[] = [];

    for (const incoming of persistable) {
      const key = incoming.idWoo.toString();
      processedIds.add(key);
      const current = existingMap.get(key);

      if (!current) {
        await client.variants.create({
          data: {
            id_woo: incoming.idWoo,
            id_padre: product.id_woo,
            name: incoming.name,
            status: incoming.status,
            price: incoming.price,
            stock: incoming.stock,
            stock_status: incoming.stock_status,
            sede: incoming.sede,
            date: incoming.date,
            created_at: timestamp,
            updated_at: timestamp,
          },
        });

        added.push({
          id_woo: key,
          name: incoming.name,
        });
        continue;
      }

      const { data: updateData, changes } = buildUpdateData(current, incoming, timestamp);
      if (changes.length > 0) {
        await client.variants.update({
          where: { id: current.id },
          data: updateData,
        });

        updated.push({
          id_woo: key,
          name: incoming.name ?? current.name,
          changes,
        });
      }
    }

    const removedRecords = existing.filter((variant) => !processedIds.has(variant.id_woo.toString()));
    if (removedRecords.length > 0) {
      await client.variants.deleteMany({
        where: { id_woo: { in: removedRecords.map((variant) => variant.id_woo) } },
      });
    }

    const removed: VariationsSyncChange[] = removedRecords.map((variant) => ({
      id_woo: variant.id_woo.toString(),
      name: variant.name,
    }));

    return { added, updated, removed };
  });

  const totals: SyncTotals = {
    added: transactionResult.added.length,
    updated: transactionResult.updated.length,
    removed: transactionResult.removed.length,
  };

  const summary: ProductSyncReport = {
    productId: product.id,
    productWooId: productWooId,
    productName: product.name ?? null,
    fetchedVariations: variations.length,
    validVariations: persistable.length,
    skippedVariations: skipped,
    added: transactionResult.added,
    updated: transactionResult.updated,
    removed: transactionResult.removed,
  };

  logs.push({
    type: 'info',
    message: `WooCommerce devolvió ${variations.length} variaciones (${persistable.length} válidas).`,
    productWooId,
    productName: product.name ?? null,
  });

  if (skipped > 0) {
    logs.push({
      type: 'warning',
      message: `Se omitieron ${skipped} variaciones sin identificador válido o duplicadas.`,
      productWooId,
      productName: product.name ?? null,
    });
  }

  if (totals.added || totals.updated || totals.removed) {
    logs.push({
      type: 'success',
      message: `Cambios aplicados → añadidas: ${totals.added}, actualizadas: ${totals.updated}, eliminadas: ${totals.removed}.`,
      productWooId,
      productName: product.name ?? null,
    });
  } else {
    logs.push({
      type: 'info',
      message: 'No se detectaron cambios para este producto.',
      productWooId,
      productName: product.name ?? null,
    });
  }

  return { summary, totals, logs };
}

async function syncAllProducts(): Promise<SyncResult> {
  ensureConfigured();

  const prisma = getPrisma();
  const productsRaw = await prisma.products.findMany({
    where: { id_woo: { not: null } },
    select: { id: true, id_woo: true, name: true },
    orderBy: { name: 'asc' },
  });

  const logs: SyncLogEntry[] = [];
  const summary: SyncSummary = {
    totalProducts: productsRaw.length,
    processedProducts: 0,
    failedProducts: 0,
    totals: { added: 0, updated: 0, removed: 0 },
    products: [],
  };

  if (productsRaw.length === 0) {
    logs.push({
      type: 'info',
      message: 'No se encontraron productos con ID de WooCommerce configurado.',
    });

    return { ok: true, logs, summary };
  }

  const concurrency = resolveSyncConcurrency();

  const processProduct = async (
    product: (typeof productsRaw)[number],
  ): Promise<{
    logs: SyncLogEntry[];
    summary: ProductSyncReport;
    totals: SyncTotals;
    failed: boolean;
  }> => {
    const productLogs: SyncLogEntry[] = [];
    const productWooId = product.id_woo;

    if (productWooId === null) {
      productLogs.push({
        type: 'warning',
        message: 'Producto sin ID de WooCommerce; se omite la sincronización.',
        productName: product.name ?? null,
      });

      return {
        logs: productLogs,
        summary: {
          productId: product.id,
          productWooId: '—',
          productName: product.name ?? null,
          fetchedVariations: 0,
          validVariations: 0,
          skippedVariations: 0,
          added: [],
          updated: [],
          removed: [],
          error: 'Producto sin ID de WooCommerce en la base de datos.',
        },
        totals: { added: 0, updated: 0, removed: 0 },
        failed: true,
      };
    }

    const normalizedProduct: ProductWithWooId = {
      id: product.id,
      id_woo: productWooId,
      name: product.name ?? null,
    };

    const productWooIdString = productWooId.toString();
    productLogs.push({
      type: 'info',
      message: `Analizando producto ${productWooIdString}.`,
      productWooId: productWooIdString,
      productName: product.name ?? null,
    });

    try {
      const variations = await fetchWooVariations(productWooId);
      const result = await syncProductVariations(prisma, normalizedProduct, variations);

      productLogs.push(...result.logs);

      return {
        logs: productLogs,
        summary: result.summary,
        totals: result.totals,
        failed: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error inesperado';

      productLogs.push({
        type: 'error',
        message: `Error al sincronizar el producto ${productWooIdString}: ${message}`,
        productWooId: productWooIdString,
        productName: product.name ?? null,
      });

      return {
        logs: productLogs,
        summary: {
          productId: product.id,
          productWooId: productWooIdString,
          productName: product.name ?? null,
          fetchedVariations: 0,
          validVariations: 0,
          skippedVariations: 0,
          added: [],
          updated: [],
          removed: [],
          error: message,
        },
        totals: { added: 0, updated: 0, removed: 0 },
        failed: true,
      };
    }
  };

  for (let index = 0; index < productsRaw.length; index += concurrency) {
    const batch = productsRaw.slice(index, index + concurrency);
    const results = await Promise.all(
      batch.map((product: (typeof productsRaw)[number]) => processProduct(product)),
    );

    for (const result of results) {
      logs.push(...result.logs);
      summary.products.push(result.summary);

      if (result.failed) {
        summary.failedProducts += 1;
        continue;
      }

      summary.processedProducts += 1;
      summary.totals.added += result.totals.added;
      summary.totals.updated += result.totals.updated;
      summary.totals.removed += result.totals.removed;
    }
  }

  return { ok: true, logs, summary };
}

export const handler = async (event: Event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    if (event.httpMethod !== 'POST') {
      return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
    }

    const result = await syncAllProducts();
    return successResponse(result);
  } catch (error) {
    console.error('[woo_courses] handler error', error);
    return errorResponse('UNEXPECTED_ERROR', 'Se ha producido un error inesperado', 500);
  }
};
