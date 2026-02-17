import { useMemo } from 'react';
import type { DealProduct } from '../../../types/deal';

export const SESSION_CODE_PREFIXES = ['form-', 'prev-', 'pci-', 'pau-'] as const;

type DealProductWithId = DealProduct & { id: string | number };

export type DefaultApplicableDealProduct = {
  id: string;
  name: string | null;
  code: string | null;
  quantity: number;
  hours: number | null;
};

export type UseApplicableDealProductsOptions<TProduct> = {
  filter?: (product: DealProduct) => product is DealProductWithId;
  mapProduct?: (product: DealProductWithId) => TProduct;
  generationKeySelector?: (product: TProduct) => string;
  sortGenerationKey?: boolean;
};

const defaultFilter: (product: DealProduct) => product is DealProductWithId = (
  product: DealProduct,
): product is DealProductWithId => {
  const id = product?.id;
  if (id == null || id === '') return false;
  const code = typeof product?.code === 'string' ? product.code.trim().toLowerCase() : '';
  return SESSION_CODE_PREFIXES.some((prefix) => code.startsWith(prefix));
};

const defaultMapProduct = (product: DealProductWithId): DefaultApplicableDealProduct => ({
  id: String(product.id),
  name: product.name ?? null,
  code: product.code ?? null,
  quantity:
    typeof product.quantity === 'number'
      ? product.quantity
      : product.quantity != null
      ? Number(product.quantity)
      : 0,
  hours:
    typeof product.hours === 'number'
      ? product.hours
      : product.hours != null
      ? Number(product.hours)
      : null,
});

const defaultGenerationKeySelector = (product: DefaultApplicableDealProduct): string => {
  const quantity =
    typeof product.quantity === 'number' && Number.isFinite(product.quantity) ? product.quantity : 0;
  return `${product.id}|${quantity}`;
};

const defaultGenerationKeySelectorAny = defaultGenerationKeySelector as (product: unknown) => string;

export function useApplicableDealProducts<TProduct = DefaultApplicableDealProduct>(
  products: DealProduct[] | null | undefined,
  options: UseApplicableDealProductsOptions<TProduct> = {},
) {
  const filter = (options.filter ?? defaultFilter) as (product: DealProduct) => product is DealProductWithId;
  const mapProduct = (options.mapProduct ?? defaultMapProduct) as (product: DealProductWithId) => TProduct;
  const generationKeySelector = (options.generationKeySelector ??
    (defaultGenerationKeySelectorAny as (product: TProduct) => string)) as (product: TProduct) => string;
  const sortGenerationKey = options.sortGenerationKey ?? false;

  return useMemo(() => {
    const source = Array.isArray(products) ? products : [];
    const applicableProducts = source.filter(filter).map((product) => mapProduct(product));
    const shouldShow = applicableProducts.length > 0;

    const productIds = applicableProducts.map((product) => {
      const rawId = (product as { id?: unknown }).id;
      return typeof rawId === 'string' ? rawId : String(rawId ?? '');
    });

    const productIdsKey = productIds.join('|');

    const generationKeyParts = applicableProducts.map((product, index) => {
      const key = generationKeySelector(product);
      return typeof key === 'string' ? key : productIds[index] ?? '';
    });

    if (sortGenerationKey) {
      generationKeyParts.sort();
    }

    const generationKey = generationKeyParts.join('|');

    return { applicableProducts, shouldShow, generationKey, productIds, productIdsKey } as const;
  }, [products, filter, mapProduct, generationKeySelector, sortGenerationKey]);
}
