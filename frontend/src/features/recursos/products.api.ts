// frontend/src/features/recursos/products.api.ts
import { API_BASE, ApiError } from '../presupuestos/api';
import type { Product } from '../../types/product';

export type ProductUpdatePayload = {
  template?: string | null;
  url_formacion?: string | null;
  active?: boolean | null;
  id_woo?: number | null;
};

export type ProductSyncSummary = {
  fetched: number;
  imported: number;
  created: number;
  updated: number;
  deactivated: number | string;
};

type ProductListResponse = {
  ok: boolean;
  products?: unknown;
  message?: string;
  error_code?: string;
};

type ProductMutationResponse = {
  ok: boolean;
  product?: unknown;
  message?: string;
  error_code?: string;
};

type ProductSyncResponse = {
  ok: boolean;
  summary?: ProductSyncSummary;
  message?: string;
  error_code?: string;
};

function parseJson(text: string): any {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ApiError('INVALID_RESPONSE', 'Respuesta JSON inválida del servidor');
  }
}

function toNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function toNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const numberValue = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new ApiError('VALIDATION_ERROR', 'El campo id_woo debe ser un número válido');
  }

  return numberValue;
}

function normalizeProduct(row: any): Product {
  if (!row || typeof row !== 'object') {
    throw new ApiError('INVALID_RESPONSE', 'Formato de producto no válido');
  }

  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at ?? null;
  const updatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ?? null;

  return {
    id: String(row.id ?? ''),
    id_pipe: String(row.id_pipe ?? ''),
    id_woo: row.id_woo == null ? null : Number(row.id_woo),
    name: row.name == null ? null : String(row.name),
    code: row.code == null ? null : String(row.code),
    category: row.category == null ? null : String(row.category),
    type: row.type == null ? null : String(row.type),
    template: row.template == null ? null : String(row.template),
    url_formacion: row.url_formacion == null ? null : String(row.url_formacion),
    active: Boolean(row.active ?? true),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function buildUpdateBody(payload: ProductUpdatePayload): Record<string, any> {
  const body: Record<string, any> = {};

  if ('template' in payload) {
    body.template = toNullableString(payload.template);
  }

  if ('url_formacion' in payload) {
    body.url_formacion = toNullableString(payload.url_formacion);
  }

  if ('active' in payload) {
    body.active = Boolean(payload.active);
  }

  if ('id_woo' in payload) {
    body.id_woo = toNullableNumber(payload.id_woo);
  }

  return body;
}

async function requestJson(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, init);
  const text = await response.text();
  const json = parseJson(text);

  if (!response.ok || json?.ok === false) {
    const code = json?.error_code ?? `HTTP_${response.status}`;
    const message = json?.message ?? 'Error inesperado en la solicitud';
    throw new ApiError(code, message, response.status);
  }

  return json;
}

export async function fetchProducts(): Promise<Product[]> {
  const json = (await requestJson(`${API_BASE}/products`)) as ProductListResponse;
  const rows = Array.isArray(json.products) ? json.products : [];
  return rows.map((row) => normalizeProduct(row));
}

export async function updateProduct(productId: string, payload: ProductUpdatePayload): Promise<Product> {
  if (!productId) {
    throw new ApiError('VALIDATION_ERROR', 'id requerido para actualizar el producto');
  }

  const body = buildUpdateBody(payload);
  const json = (await requestJson(`${API_BASE}/products/${encodeURIComponent(productId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })) as ProductMutationResponse;

  return normalizeProduct(json.product);
}

export async function syncProducts(): Promise<ProductSyncSummary | null> {
  const json = (await requestJson(`${API_BASE}/products-sync`, {
    method: 'POST',
  })) as ProductSyncResponse;

  return json.summary ?? null;
}
