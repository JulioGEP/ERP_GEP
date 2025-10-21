// backend/functions/woo_courses.ts
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
]);

const ESSENTIAL_VARIATION_ATTRIBUTE_FIELDS = new Set(['id', 'name', 'option', 'slug']);

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
  return successResponse({ data: sanitized, status: response.status });
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
