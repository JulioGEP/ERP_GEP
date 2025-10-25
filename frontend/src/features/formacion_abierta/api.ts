import { API_BASE, ApiError } from '../presupuestos/api';
import { requestJson } from '../../shared/api/client';
import type {
  DealTag,
  ProductDefaults,
  ProductDefaultsUpdatePayload,
  ProductInfo,
  VariantInfo,
  VariantUpdatePayload,
} from './types';
import {
  normalizeDealTag,
  normalizeProductDefaults,
  normalizeProductFromResponse,
  normalizeVariantFromResponse,
} from './utils';

export type ProductsVariantsResponse = {
  ok?: boolean;
  products?: unknown;
  message?: string;
};

export type ProductDefaultsUpdateResponse = {
  ok?: boolean;
  product?: unknown;
  message?: string;
};

export type VariantBulkCreateResponse = {
  ok?: boolean;
  created?: unknown;
  skipped?: number;
  message?: string;
};

export type DeleteVariantResponse = {
  ok?: boolean;
  message?: string;
  error_code?: string;
};

export type VariantUpdateResponse = {
  ok?: boolean;
  variant?: unknown;
  message?: string;
};

export type DealsByVariationResponse = {
  ok?: boolean;
  deals?: unknown;
  message?: string;
};

export async function fetchProductsWithVariants(): Promise<ProductInfo[]> {
  const json = await requestJson<ProductsVariantsResponse>(
    `${API_BASE}/products-variants`,
    { headers: { Accept: 'application/json' } },
    { defaultErrorMessage: 'No se pudieron obtener las variantes.' },
  );

  const products = Array.isArray(json.products) ? json.products : [];
  return products.map((product) => normalizeProductFromResponse(product));
}

export async function deleteProductVariant(variantId: string): Promise<string | null> {
  const json = await requestJson<DeleteVariantResponse>(
    `${API_BASE}/products-variants/${encodeURIComponent(variantId)}`,
    { method: 'DELETE', headers: { Accept: 'application/json' } },
    { defaultErrorMessage: 'No se pudo eliminar la variante.' },
  );

  return typeof json.message === 'string' ? json.message : null;
}

export async function updateProductVariantDefaults(
  productId: string,
  updates: ProductDefaultsUpdatePayload,
): Promise<ProductDefaults> {
  const json = await requestJson<ProductDefaultsUpdateResponse>(
    `${API_BASE}/product-variant-settings`,
    {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ product_id: productId, ...updates }),
    },
    { defaultErrorMessage: 'No se pudo actualizar la configuración del producto.' },
  );

  if (!json.product) {
    throw new ApiError('UPDATE_DEFAULTS_ERROR', 'No se pudo actualizar la configuración del producto.');
  }

  return normalizeProductDefaults(json.product);
}

export async function createProductVariantsForProduct(
  productId: string,
  sedes: string[],
  dates: string[],
): Promise<{ created: VariantInfo[]; skipped: number; message: string | null }> {
  const json = await requestJson<VariantBulkCreateResponse>(
    `${API_BASE}/product-variants-create`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ product_id: productId, sedes, dates }),
    },
    { defaultErrorMessage: 'No se pudieron crear las variantes.' },
  );

  const createdRaw = Array.isArray(json.created) ? json.created : [];
  const created = createdRaw.map((item, index) =>
    normalizeVariantFromResponse(item, `${productId}-new-${index}`),
  );

  return {
    created,
    skipped: typeof json.skipped === 'number' ? json.skipped : 0,
    message: typeof json.message === 'string' ? json.message : null,
  };
}

export async function updateProductVariant(
  variantId: string,
  updates: VariantUpdatePayload,
): Promise<VariantInfo> {
  const json = await requestJson<VariantUpdateResponse>(
    `${API_BASE}/products-variants/${encodeURIComponent(variantId)}`,
    {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    },
    { defaultErrorMessage: 'No se pudo actualizar la variante.' },
  );

  if (!json.variant) {
    throw new ApiError('UPDATE_ERROR', 'No se pudo actualizar la variante.');
  }

  return normalizeVariantFromResponse(json.variant, variantId);
}

export async function fetchDealsByVariation(variationWooId: string): Promise<DealTag[]> {
  const json = await requestJson<DealsByVariationResponse>(
    `${API_BASE}/deals?w_id_variation=${encodeURIComponent(variationWooId)}`,
    { headers: { Accept: 'application/json' } },
    { defaultErrorMessage: 'No se pudieron obtener los deals.' },
  );

  const deals = Array.isArray(json.deals) ? json.deals : [];
  return deals
    .map((deal) => normalizeDealTag(deal))
    .filter((deal): deal is DealTag => deal !== null);
}
