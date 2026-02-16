// backend/functions/product-variants-create.ts

// ❌ quitamos Prisma porque solo lo usabas para Decimal
// import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import { toMadridISOString } from './_shared/timezone';
import { getWooStockStatusFromDb } from './_shared/variant-defaults';

function resolveWooBaseUrl(): string {
  const raw = (process.env.WOO_BASE_URL || '').trim();
  if (!raw) return '';

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return raw.replace(/\/$/, '');
  }

  if (parsed.hostname.toLowerCase() === 'www.gepcoformacion.es') {
    parsed.hostname = 'gepcoformacion.es';
  }

  return parsed.toString().replace(/\/$/, '');
}

const WOO_BASE = resolveWooBaseUrl();
const WOO_KEY = process.env.WOO_KEY || '';
const WOO_SECRET = process.env.WOO_SECRET || '';

const LOCATION_KEYWORDS = ['localizacion', 'ubicacion', 'sede'];
const DATE_KEYWORDS = ['fecha'];

function ensureWooConfigured() {
  if (!WOO_BASE || !WOO_KEY || !WOO_SECRET) {
    throw new Error('WooCommerce configuration missing');
  }
}

type VariantRecord = {
  id: string;
  id_woo: bigint;
  name: string | null;
  status: string | null;
  finalizar: string | null;
  price: Decimal | string | null; // ✅ Decimal correcto
  stock: number | null;
  stock_status: string | null;
  sede: string | null;
  date: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

type VariantCreatePayload = {
  product_id?: string;
  sedes?: Array<string> | string;
  dates?: Array<string> | string;
  combined_variants?: Array<{ sede?: string; date?: string }> | string;
};

type WooProductAttribute = {
  id?: number;
  name?: string;
  slug?: string;
  position?: number;
  visible?: boolean;
  variation?: boolean;
  options?: string[];
};

type WooErrorPayload = {
  code?: string;
  message?: string;
  data?: {
    status?: number;
    [key: string]: unknown;
  };
};

type WooVariationResponse = {
  id?: number;
  name?: string;
  status?: string;
  price?: string;
  regular_price?: string;
  stock_status?: string;
  stock_quantity?: number | null;
  date_created_gmt?: string;
  date_modified_gmt?: string;
};

type ParsedDate = {
  value: Date;
  display: string;
  key: string;
};

type VariantCombo = {
  sede: string;
  date: ParsedDate;
};

function formatWooErrorMessage(
  fallbackMessage: string,
  responseStatus: number,
  payload: unknown,
): string {
  const data = (payload && typeof payload === 'object' ? payload : {}) as WooErrorPayload;
  const message =
    typeof data.message === 'string' && data.message.trim().length > 0
      ? data.message.trim()
      : fallbackMessage;
  const code = typeof data.code === 'string' && data.code.trim().length > 0 ? data.code.trim() : null;
  const status = typeof data.data?.status === 'number' ? data.data.status : responseStatus;

  const suffix = [`status ${status}`, code ? `code ${code}` : null].filter(Boolean).join(', ');
  const permissionHintCodes = new Set([
    'woocommerce_rest_cannot_view',
    'woocommerce_rest_cannot_list',
    'woocommerce_rest_cannot_create',
    'rest_cannot_view',
    'rest_cannot_list',
    'rest_cannot_create',
  ]);
  const hint = code && permissionHintCodes.has(code)
    ? ' Revisa que la API key de WooCommerce tenga permisos Read/Write y que el usuario asociado pueda gestionar productos.'
    : '';

  return `${message} (${suffix}).${hint}`;
}

function parseSingleDate(value: string): ParsedDate {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    throw new Error(`INVALID_DATE:${value}`);
  }
  const [, dayText, monthText, yearText] = match;
  const day = Number.parseInt(dayText, 10);
  const month = Number.parseInt(monthText, 10);
  const year = Number.parseInt(yearText, 10);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) {
    throw new Error(`INVALID_DATE:${value}`);
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return {
    value: date,
    display: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`,
    key,
  };
}

function formatDateDisplay(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function normalizeVariant(record: VariantRecord) {
  const price =
    record.price == null
      ? null
      : typeof record.price === 'string'
        ? record.price
        : record.price.toString();

  return {
    id: record.id,
    id_woo: record.id_woo?.toString() ?? null,
    name: record.name ?? null,
    status: record.status ?? null,
    finalizar: record.finalizar ?? 'Activa',
    price,
    stock: record.stock ?? null,
    stock_status: record.stock_status ?? null,
    sede: record.sede ?? null,
    date: toMadridISOString(record.date),
    created_at: toMadridISOString(record.created_at),
    updated_at: toMadridISOString(record.updated_at),
  } as const;
}

function normalizeAttributeText(value: string | undefined | null): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function matchesAttributeKeywords(attribute: WooProductAttribute, keywords: string[]): boolean {
  const normalizedName = normalizeAttributeText(attribute?.name ?? attribute?.slug ?? null);
  if (!normalizedName) return false;
  return keywords.some((keyword) => normalizedName.includes(keyword));
}

function parseProductId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('INVALID_PRODUCT_ID');
  }
  return value.trim();
}

function parseSedes(input: VariantCreatePayload['sedes']): string[] {
  if (input == null) return [];
  const values = Array.isArray(input) ? input : String(input).split(/[\n,]/);
  const normalized = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of normalized) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function parseDates(input: VariantCreatePayload['dates']): ParsedDate[] {
  if (input == null) return [];
  const values = Array.isArray(input) ? input : String(input).split(',');
  const seen = new Set<string>();
  const parsed: ParsedDate[] = [];

  for (const raw of values) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const parsedDate = parseSingleDate(trimmed);
    const key = parsedDate.key;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    parsed.push(parsedDate);
  }

  return parsed;
}

function parseCombinedVariants(input: VariantCreatePayload['combined_variants']): VariantCombo[] {
  if (input == null) return [];

  const raw = Array.isArray(input)
    ? input.map((item) =>
        typeof item === 'string'
          ? item
          : `${item?.sede ?? ''},${item?.date ?? ''}`,
      )
    : String(input).split(';');

  const seen = new Set<string>();
  const combos: VariantCombo[] = [];

  for (const chunk of raw) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    const [sedeRaw, ...dateParts] = trimmed.split(',');
    const sede = sedeRaw.trim();
    const dateText = dateParts.join(',').trim();

    if (!sede || !dateText) {
      throw new Error(`INVALID_VARIANT:${trimmed}`);
    }

    const parsedDate = parseSingleDate(dateText);
    const key = `${sede.toLowerCase()}|${parsedDate.key}`;

    if (seen.has(key)) continue;
    seen.add(key);

    combos.push({ sede, date: parsedDate });
  }

  return combos;
}

function buildCombos(sedes: string[], dates: ParsedDate[]): VariantCombo[] {
  const combos: VariantCombo[] = [];
  for (const sede of sedes) {
    for (const date of dates) {
      combos.push({ sede, date });
    }
  }
  return combos;
}

async function fetchWooProductAttributes(productWooId: bigint, token: string): Promise<WooProductAttribute[]> {
  const url = `${WOO_BASE}/wp-json/wc/v3/products/${productWooId.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Basic ${token}`,
        Accept: 'application/json',
      },
    });
  } catch (error) {
    console.error('[product-variants-create] network error fetching WooCommerce product', { productWooId, error });
    throw new Error('No se pudo conectar con WooCommerce');
  }

  const text = await response.text();
  let data: any = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      console.error('[product-variants-create] invalid JSON fetching WooCommerce product', {
        productWooId,
        error,
        text,
      });
      throw new Error('Respuesta inválida de WooCommerce');
    }
  }

  if (!response.ok) {
    throw new Error(
      formatWooErrorMessage('Error al consultar WooCommerce', response.status, data),
    );
  }

  return Array.isArray(data?.attributes) ? (data.attributes as WooProductAttribute[]) : [];
}

function collectUniqueSedes(combos: VariantCombo[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const combo of combos) {
    const trimmed = combo.sede.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function collectUniqueDates(combos: VariantCombo[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const combo of combos) {
    const display = combo.date.display.trim();
    if (!display) continue;
    if (seen.has(display)) continue;
    seen.add(display);
    result.push(display);
  }

  return result;
}

function ensureWooProductAttributesForCombos(
  attributes: WooProductAttribute[],
  combos: VariantCombo[],
): { attributes: WooProductAttribute[]; changed: boolean } {
  const next = attributes.map((attribute) => ({
    ...attribute,
    options: Array.isArray(attribute.options) ? [...attribute.options] : [],
  }));

  let changed = false;

  const sedeOptions = collectUniqueSedes(combos);
  const dateOptions = collectUniqueDates(combos);

  const locationIndex = next.findIndex((attribute) => matchesAttributeKeywords(attribute, LOCATION_KEYWORDS));
  if (locationIndex >= 0) {
    const attribute = next[locationIndex];
    const optionSet = new Set(
      (attribute.options ?? [])
        .map((option) => option.trim().toLowerCase())
        .filter((option) => option.length > 0),
    );
    for (const option of sedeOptions) {
      const key = option.trim().toLowerCase();
      if (!optionSet.has(key)) {
        attribute.options = [...(attribute.options ?? []), option];
        optionSet.add(key);
        changed = true;
      }
    }
    if (attribute.variation !== true) {
      attribute.variation = true;
      changed = true;
    }
  } else if (sedeOptions.length) {
    next.push({
      name: 'Sede',
      options: sedeOptions,
      variation: true,
      visible: true,
      position: next.length + 1,
    });
    changed = true;
  }

  const dateIndex = next.findIndex((attribute) => matchesAttributeKeywords(attribute, DATE_KEYWORDS));
  if (dateIndex >= 0) {
    const attribute = next[dateIndex];
    const optionSet = new Set(
      (attribute.options ?? [])
        .map((option) => option.trim())
        .filter((option) => option.length > 0),
    );
    for (const option of dateOptions) {
      if (!optionSet.has(option)) {
        attribute.options = [...(attribute.options ?? []), option];
        changed = true;
      }
    }
    if (attribute.variation !== true) {
      attribute.variation = true;
      changed = true;
    }
  } else if (dateOptions.length) {
    next.push({
      name: 'Fecha',
      options: dateOptions,
      variation: true,
      visible: true,
      position: next.length + 1,
    });
    changed = true;
  }

  return { attributes: next, changed };
}

async function updateWooProductAttributes(
  productWooId: bigint,
  token: string,
  attributes: WooProductAttribute[],
): Promise<WooProductAttribute[]> {
  const url = `${WOO_BASE}/wp-json/wc/v3/products/${productWooId.toString()}`;
  const payloadAttributes = attributes.map((attribute, index) => {
    const options = Array.isArray(attribute.options) ? attribute.options : [];
    const payload: Record<string, any> = {
      options,
      visible: attribute.visible ?? false,
      variation: attribute.variation ?? false,
      position: attribute.position ?? index + 1,
    };

    if (attribute.id != null) {
      payload.id = attribute.id;
    }
    if (attribute.name) {
      payload.name = attribute.name;
    }

    return payload;
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Basic ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ attributes: payloadAttributes }),
    });
  } catch (error) {
    console.error('[product-variants-create] network error updating WooCommerce product attributes', {
      productWooId,
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
      console.error('[product-variants-create] invalid JSON updating WooCommerce product attributes', {
        productWooId,
        error,
        text,
      });
      throw new Error('Respuesta inválida de WooCommerce');
    }
  }

  if (!response.ok) {
    throw new Error(
      formatWooErrorMessage('Error al actualizar los atributos en WooCommerce', response.status, data),
    );
  }

  return Array.isArray(data?.attributes) ? (data.attributes as WooProductAttribute[]) : attributes;
}

function formatDateAttributeValue(date: Date | string | null): string {
  if (!date) return '';
  const current = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(current.getTime())) return '';
  const year = current.getUTCFullYear();
  const month = String(current.getUTCMonth() + 1).padStart(2, '0');
  const day = String(current.getUTCDate()).padStart(2, '0');
  return `${day}/${month}/${year}`;
}

async function createWooVariation(
  productWooId: bigint,
  token: string,
  payload: Record<string, any>,
): Promise<WooVariationResponse> {
  const url = `${WOO_BASE}/wp-json/wc/v3/products/${productWooId.toString()}/variations`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error('[product-variants-create] network error creating WooCommerce variation', {
      productWooId,
      payload,
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
      console.error('[product-variants-create] invalid JSON creating WooCommerce variation', {
        productWooId,
        payload,
        error,
        text,
      });
      throw new Error('Respuesta inválida de WooCommerce');
    }
  }

  if (!response.ok) {
    throw new Error(
      formatWooErrorMessage('Error al crear variante en WooCommerce', response.status, data),
    );
  }

  return data as WooVariationResponse;
}

function normalizeExistingKey(sede: string | null | undefined, date: Date | string | null | undefined): string {
  const sedeKey = (sede ?? '').trim().toLowerCase();
  let dateKey = '';
  if (date) {
    const parsed = typeof date === 'string' ? new Date(date) : date;
    if (!Number.isNaN(parsed.getTime())) {
      dateKey = `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
    }
  }
  return `${sedeKey}::${dateKey}`;
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    if (event.httpMethod !== 'POST') {
      return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
    }

    if (!event.body) {
      return errorResponse('VALIDATION_ERROR', 'Cuerpo de la petición requerido', 400);
    }

    let payload: VariantCreatePayload;
    try {
      payload = JSON.parse(event.body) as VariantCreatePayload;
    } catch (error) {
      return errorResponse('VALIDATION_ERROR', 'JSON inválido', 400);
    }

    let productId: string;
    try {
      productId = parseProductId(payload.product_id ?? null);
    } catch (error) {
      return errorResponse('VALIDATION_ERROR', 'ID de producto inválido', 400);
    }

    let sedes: string[];
    let dates: ParsedDate[];
    let combinedVariants: VariantCombo[];
    try {
      sedes = parseSedes(payload.sedes);
      dates = parseDates(payload.dates);
      combinedVariants = parseCombinedVariants(payload.combined_variants);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('INVALID_DATE')) {
        return errorResponse('VALIDATION_ERROR', `Formato de fecha inválido: ${error.message.split(':')[1]}`, 400);
      }
      if (error instanceof Error && error.message.startsWith('INVALID_VARIANT')) {
        return errorResponse(
          'VALIDATION_ERROR',
          `Formato de variante inválido: ${error.message.split(':')[1]}`,
          400,
        );
      }
      return errorResponse('VALIDATION_ERROR', 'Datos inválidos', 400);
    }

    const combosFromMatrix = sedes.length && dates.length ? buildCombos(sedes, dates) : [];
    const combos = [...combinedVariants, ...combosFromMatrix];
    if (!combos.length) {
      return errorResponse(
        'VALIDATION_ERROR',
        'Debes indicar al menos una variante combinada o una sede y una fecha',
        400,
      );
    }

    const prisma = getPrisma();
    const product = await prisma.products.findUnique({
      where: { id: productId },
      select: {
        id: true,
        id_woo: true,
        variant_price: true,
        variant_stock_status: true,
        variant_stock_quantity: true,
        variant_start: true,
        variant_end: true,
      },
    });

    if (!product) {
      return errorResponse('NOT_FOUND', 'Producto no encontrado', 404);
    }

    if (!product.id_woo) {
      return errorResponse('VALIDATION_ERROR', 'El producto no tiene ID de WooCommerce configurado', 400);
    }

    if (!product.variant_price) {
      return errorResponse('VALIDATION_ERROR', 'Configura un precio por defecto antes de crear variantes', 400);
    }

    const stockStatus = getWooStockStatusFromDb(product.variant_stock_status);
    const priceText = product.variant_price.toString();

    ensureWooConfigured();
    const token = Buffer.from(`${WOO_KEY}:${WOO_SECRET}`).toString('base64');

    const existing = await prisma.variants.findMany({
      where: { id_padre: product.id_woo },
      select: { sede: true, date: true },
    });

    // ✅ Evita 'any' implícito en el map
    const existingSet = new Set(
      (existing as Array<{ sede: string | null; date: Date | string | null }>)
        .map((variant) => normalizeExistingKey(variant.sede, variant.date))
    );

    const combosToCreate = combos.filter(
      (combo) => !existingSet.has(normalizeExistingKey(combo.sede, combo.date.value))
    );

    if (!combosToCreate.length) {
      return successResponse({ ok: true, created: [], skipped: combos.length, message: 'Todas las combinaciones ya existen.' });
    }

    let attributes = await fetchWooProductAttributes(product.id_woo, token);
    const ensuredAttributes = ensureWooProductAttributesForCombos(attributes, combosToCreate);
    if (ensuredAttributes.changed) {
      attributes = await updateWooProductAttributes(product.id_woo, token, ensuredAttributes.attributes);
    }

    const locationAttribute = attributes.find((attribute) => matchesAttributeKeywords(attribute, LOCATION_KEYWORDS));
    const dateAttribute = attributes.find((attribute) => matchesAttributeKeywords(attribute, DATE_KEYWORDS));

    const createdVariants: VariantRecord[] = [];

    for (const combo of combosToCreate) {
      const attributesPayload: Array<Record<string, any>> = [];
      const sedeOption = combo.sede.trim();
      const dateOption = combo.date.display;

      if (locationAttribute) {
        attributesPayload.push({
          id: locationAttribute.id,
          name: locationAttribute.name,
          option: sedeOption,
        });
      } else {
        attributesPayload.push({ name: 'Sede', option: sedeOption });
      }

      if (dateAttribute) {
        attributesPayload.push({
          id: dateAttribute.id,
          name: dateAttribute.name,
          option: dateOption,
        });
      } else {
        attributesPayload.push({ name: 'Fecha', option: dateOption });
      }

      const metaData: Array<{ key: string; value: string }> = [];
      if (product.variant_start) {
        const value = formatDateAttributeValue(product.variant_start);
        if (value) {
          metaData.push({ key: 'start_date', value });
        }
      }
      if (product.variant_end) {
        const value = formatDateAttributeValue(product.variant_end);
        if (value) {
          metaData.push({ key: 'end_date', value });
        }
      }

      const wooPayload: Record<string, any> = {
        status: 'publish',
        regular_price: priceText,
        price: priceText,
        stock_status: stockStatus || 'instock',
        attributes: attributesPayload,
      };

      if (product.variant_stock_quantity != null) {
        wooPayload.manage_stock = true;
        wooPayload.stock_quantity = product.variant_stock_quantity;
      } else {
        wooPayload.manage_stock = false;
      }

      if (metaData.length > 0) {
        wooPayload.meta_data = metaData;
      }

      const wooVariant = await createWooVariation(product.id_woo, token, wooPayload);
      if (wooVariant.id == null) {
        throw new Error('WooCommerce no devolvió un identificador para la variante creada');
      }

      const createdAt = wooVariant.date_created_gmt ? new Date(wooVariant.date_created_gmt) : new Date();
      const updatedAt = wooVariant.date_modified_gmt ? new Date(wooVariant.date_modified_gmt) : createdAt;
      const wooId = BigInt(wooVariant.id);

      const record = await prisma.variants.create({
        data: {
          id_woo: wooId,
          id_padre: product.id_woo,
          name: wooVariant.name ?? `${sedeOption} - ${dateOption}`,
          status: wooVariant.status ?? 'publish',
          finalizar: 'Activa',
          price: product.variant_price,
          stock: product.variant_stock_quantity ?? null,
          stock_status: wooVariant.stock_status ?? stockStatus,
          sede: sedeOption,
          date: combo.date.value,
          created_at: createdAt,
          updated_at: updatedAt,
        },
        select: {
          id: true,
          id_woo: true,
          name: true,
          status: true,
          finalizar: true,
          price: true,
          stock: true,
          stock_status: true,
          sede: true,
          date: true,
          created_at: true,
          updated_at: true,
        },
      });

      createdVariants.push(record as VariantRecord);
    }

    const created = createdVariants.map(normalizeVariant);
    const skipped = combos.length - combosToCreate.length;

    const createdSummary = created
      .map((variant) => {
        const dateText = formatDateDisplay(variant.date);
        const sedeText = variant.sede ?? 'Sin sede';
        return dateText ? `${sedeText} (${dateText})` : sedeText;
      })
      .filter((text) => text.length > 0)
      .join('; ');

    const messageParts: string[] = [];
    if (createdSummary) {
      messageParts.push(`Variantes creadas: ${createdSummary}.`);
    }
    if (skipped > 0) {
      messageParts.push(`Combinaciones omitidas por existir: ${skipped}.`);
    }

    return successResponse({
      ok: true,
      created,
      skipped,
      message: messageParts.length ? messageParts.join(' ') : undefined,
    });
  } catch (error) {
    console.error('[product-variants-create] handler error', error);
    if (error instanceof Error) {
      if (error.message === 'WooCommerce configuration missing') {
        return errorResponse('CONFIG_ERROR', 'Configuración de WooCommerce incompleta', 500);
      }
      if (error.message.includes('WooCommerce')) {
        return errorResponse('WOO_ERROR', error.message, 502);
      }
      return errorResponse('CREATE_ERROR', error.message, 400);
    }
    return errorResponse('UNEXPECTED_ERROR', 'Se ha producido un error inesperado', 500);
  }
};
