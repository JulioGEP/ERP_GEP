import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { DealProduct } from '../../../types/deal';
import { SESSION_CODE_PREFIXES, useApplicableDealProducts } from './useApplicableDealProducts';

describe('useApplicableDealProducts', () => {
  const baseProducts: DealProduct[] = [
    { id: '1', code: `${SESSION_CODE_PREFIXES[0]}001`, name: 'Curso A', quantity: 2, hours: 3 },
    { id: '2', code: 'other', name: 'Otro', quantity: 1, hours: 1 },
    { id: '3', code: `${SESSION_CODE_PREFIXES[1]}002`, name: 'Curso B', quantity: 4, hours: 6 },
  ];

  it('filters products using the default configuration', () => {
    const { result } = renderHook(({ products }) => useApplicableDealProducts(products), {
      initialProps: { products: baseProducts },
    });

    expect(result.current.shouldShow).toBe(true);
    expect(result.current.applicableProducts).toHaveLength(2);
    expect(result.current.applicableProducts.map((product) => product.id)).toEqual(['1', '3']);
    expect(result.current.productIds).toEqual(['1', '3']);
    expect(result.current.productIdsKey).toBe('1|3');
    expect(result.current.generationKey).toBe('1|2|3|4');
  });

  it('keeps stable references when products do not change', () => {
    const { result, rerender } = renderHook(({ products }) => useApplicableDealProducts(products), {
      initialProps: { products: baseProducts },
    });

    const firstResult = result.current;
    rerender({ products: baseProducts });

    expect(result.current).toBe(firstResult);
    expect(result.current.applicableProducts).toBe(firstResult.applicableProducts);
  });

  it('supports custom filter, mapper and generation key logic', () => {
    const customProducts: DealProduct[] = [
      { id: 'alpha', name: 'Servicio A', quantity: 5 },
      { id: 'beta', name: 'Servicio B', quantity: 3 },
    ];

    const filter = (product: DealProduct): product is DealProduct & { id: string } => product.id === 'beta';
    const mapProduct = (product: DealProduct & { id: string }) => ({
      id: `custom-${product.id}`,
      label: product.name ?? null,
      metric:
        typeof product.quantity === 'number' && Number.isFinite(product.quantity) ? product.quantity : 0,
    });

    const generationKeySelector = (product: { id: string; metric: number }) => `${product.id}:${product.metric}`;

    const { result } = renderHook(() =>
      useApplicableDealProducts(customProducts, {
        filter,
        mapProduct,
        generationKeySelector,
        sortGenerationKey: true,
      }),
    );

    expect(result.current.shouldShow).toBe(true);
    expect(result.current.applicableProducts).toEqual([
      { id: 'custom-beta', label: 'Servicio B', metric: 3 },
    ]);
    expect(result.current.generationKey).toBe('custom-beta:3');
    expect(result.current.productIds).toEqual(['custom-beta']);
  });

  it('returns empty results when no product matches', () => {
    const { result } = renderHook(() => useApplicableDealProducts([]));

    expect(result.current.shouldShow).toBe(false);
    expect(result.current.applicableProducts).toHaveLength(0);
    expect(result.current.generationKey).toBe('');
  });
});
