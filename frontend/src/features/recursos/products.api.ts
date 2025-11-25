// frontend/src/features/recursos/products.api.ts
import { ApiError, requestJson } from '../../api/client';
import type { Product, ProductAttribute } from '../../types/product';

export type ProductUpdatePayload = {
  template?: string | null;
  url_formacion?: string | null;
  active?: boolean | null;
  id_woo?: number | null;
  provider_ids?: number[] | null;
  almacen_stock?: number | null;
  atributos?: ProductAttribute[] | null;
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

  const atributos = Array.isArray(row.atributos)
    ? row.atributos
        .map((value: any) => ({
          nombre: typeof value?.nombre === 'string' ? value.nombre.trim() : '',
          valor: typeof value?.valor === 'string' ? value.valor.trim() : '',
          cantidad: Number.isFinite(Number(value?.cantidad)) ? Math.trunc(Number(value.cantidad)) : 0,
        }))
        .filter((item) => item.nombre && item.valor && Number.isSafeInteger(item.cantidad) && item.cantidad >= 0)
    : [];

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
    atributos,
    almacen_stock:
      typeof row.almacen_stock === 'number'
        ? row.almacen_stock
        : row.almacen_stock != null && !Number.isNaN(Number(row.almacen_stock))
        ? Number(row.almacen_stock)
        : null,
    provider_ids: Array.isArray(row.provider_ids)
      ? row.provider_ids
          .map((value: any) => Number(value))
          .filter((value: number) => Number.isInteger(value))
      : [],
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

  if ('provider_ids' in payload) {
    if (payload.provider_ids == null) {
      body.provider_ids = [];
    } else if (Array.isArray(payload.provider_ids)) {
      const parsed = payload.provider_ids
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value));
      body.provider_ids = parsed;
    } else {
      throw new ApiError('VALIDATION_ERROR', 'provider_ids debe ser un array de números');
    }
  }

  if ('almacen_stock' in payload) {
    if (payload.almacen_stock === null) {
      body.almacen_stock = null;
    } else if (payload.almacen_stock === undefined) {
      // no-op
    } else if (typeof payload.almacen_stock === 'number' && Number.isFinite(payload.almacen_stock)) {
      body.almacen_stock = Math.trunc(payload.almacen_stock);
    } else {
      throw new ApiError('VALIDATION_ERROR', 'almacen_stock debe ser un número válido');
    }
  }

  if ('atributos' in payload) {
    if (payload.atributos == null) {
      body.atributos = [];
    } else if (Array.isArray(payload.atributos)) {
      const sanitized = payload.atributos
        .map((item) => ({
          nombre: String(item.nombre ?? '').trim(),
          valor: String(item.valor ?? '').trim(),
          cantidad: Math.trunc(Number(item.cantidad ?? 0)),
        }))
        .filter((item) => item.nombre && item.valor && Number.isSafeInteger(item.cantidad) && item.cantidad >= 0);

      body.atributos = sanitized;
    } else {
      throw new ApiError('VALIDATION_ERROR', 'atributos debe ser un array de objetos');
    }
  }

  return body;
}

const requestOptions = {
  defaultErrorMessage: 'Error inesperado en la solicitud',
  invalidResponseMessage: 'Respuesta JSON inválida del servidor',
};

export async function fetchProducts(): Promise<Product[]> {
  const json = await requestJson<ProductListResponse>('/products', undefined, requestOptions);
  const rows = Array.isArray(json.products) ? json.products : [];
  return rows.map((row) => normalizeProduct(row));
}

export async function updateProduct(productId: string, payload: ProductUpdatePayload): Promise<Product> {
  if (!productId) {
    throw new ApiError('VALIDATION_ERROR', 'id requerido para actualizar el producto');
  }

  const body = buildUpdateBody(payload);
  const json = await requestJson<ProductMutationResponse>(
    `/products/${encodeURIComponent(productId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    },
    requestOptions,
  );

  return normalizeProduct(json.product);
}

export async function syncProducts(): Promise<ProductSyncSummary | null> {
  const json = await requestJson<ProductSyncResponse>(
    '/products-sync',
    {
      method: 'POST',
    },
    requestOptions,
  );

  return json.summary ?? null;
}
