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

  const sanitized = removeImageFields(data);
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
