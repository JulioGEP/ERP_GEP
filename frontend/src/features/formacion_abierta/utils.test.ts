import { describe, expect, it } from 'vitest';

import {
  buildVariantGroups,
  findDealProductPriceForProduct,
  normalizeDealStudentsCount,
  normalizeDealTag,
  normalizeProductDefaults,
  normalizeProductFromResponse,
  normalizeVariantFromResponse,
} from './utils';
import type { DealTag, ProductInfo, VariantInfo } from './types';

const sampleVariant = (overrides: Partial<VariantInfo> = {}): VariantInfo => ({
  id: 'v-1',
  id_woo: 'woo-1',
  name: 'Variant',
  status: 'publish',
  price: '120',
  stock: 5,
  stock_status: 'instock',
  sede: 'Madrid',
  date: '2025-01-10',
  trainer_id: null,
  trainer_ids: [],
  trainer: null,
  trainers: [],
  trainer_invite_status: 'NOT_SENT',
  trainer_invite_statuses: {},
  trainer_invites: [],
  sala_id: null,
  sala: null,
  unidad_movil_id: null,
  unidad_movil_ids: [],
  unidad: null,
  unidades: [],
  created_at: null,
  updated_at: null,
  ...overrides,
});

describe('normalizeVariantFromResponse', () => {
  it('normalizes numeric fields and fallback id', () => {
    const variant = normalizeVariantFromResponse(
      {
        id_woo: 55,
        stock: '7',
        trainer_id: ' 123 ',
        sala: { sala_id: ' 88 ', name: 'Sala 1', sede: 'Madrid' },
      },
      'fallback-id',
    );

    expect(variant.id).toBe('fallback-id');
    expect(variant.stock).toBe(7);
    expect(variant.trainer_id).toBe('123');
    expect(variant.trainer_ids).toEqual(['123']);
    expect(variant.sala?.sala_id).toBe('88');
    expect(variant.id_woo).toBe('55');
  });
});

describe('normalizeProductFromResponse', () => {
  it('maps variants and default values to ProductInfo', () => {
    const product = normalizeProductFromResponse({
      id: 42,
      id_woo: null,
      default_variant_stock_quantity: '4',
      default_variant_price: 99,
      variants: [
        {
          id: 1,
          id_woo: 5,
          stock: '3',
          name: 'Madrid 10/01/2025',
        },
      ],
    });

    expect(product.id).toBe('42');
    expect(product.default_variant_stock_quantity).toBe(4);
    expect(product.default_variant_price).toBe('99');
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0].id).toBe('1');
    expect(product.variants[0].stock).toBe(3);
  });
});

describe('normalizeProductDefaults', () => {
  it('sanitizes optional numbers and strings', () => {
    const defaults = normalizeProductDefaults({
      default_variant_stock_quantity: '10',
      default_variant_price: 120,
      hora_inicio: '08:00',
    });

    expect(defaults.default_variant_stock_quantity).toBe(10);
    expect(defaults.default_variant_price).toBe('120');
    expect(defaults.hora_inicio).toBe('08:00');
  });
});

describe('normalizeDealTag', () => {
  it('builds a deal tag with derived fields', () => {
    const deal = normalizeDealTag({
      deal_id: 7,
      title: 'Formación Empresa',
      products: [{ id: 'p1', name: 'Curso', price: '150' }],
      _count: { alumnos: '12' },
      organization: { name: '  Org  ' },
      person: { first_name: ' Ana ', last_name: ' Pérez ' },
      fundae_label: ' FUNDAE ',
      po: ' PO-01 ',
    });

    expect(deal).not.toBeNull();
    expect(deal!.deal_id).toBe('7');
    expect(deal!.students_count).toBe(12);
    expect(deal!.organization).toEqual({ name: 'Org' });
    expect(deal!.person).toEqual({ first_name: 'Ana', last_name: 'Pérez' });
    expect(deal!.products[0].price).toBe('150');
    expect(deal!.fundae_label).toBe('FUNDAE');
    expect(deal!.po).toBe('PO-01');
  });

  it('returns null when essential fields are missing', () => {
    expect(normalizeDealTag({ title: 'Sin id' })).toBeNull();
    expect(normalizeDealTag({ deal_id: 3 })).toBeNull();
  });
});

describe('normalizeDealStudentsCount', () => {
  it('converts string values to numbers and clamps negatives', () => {
    expect(normalizeDealStudentsCount('8')).toBe(8);
    expect(normalizeDealStudentsCount('-5')).toBe(0);
    expect(normalizeDealStudentsCount('abc')).toBe(0);
  });
});

describe('findDealProductPriceForProduct', () => {
  it('finds matching price by code or falls back to first available', () => {
    const deals: DealTag[] = [
      {
        deal_id: 'd1',
        title: 'Deal',
        products: [
          { id: 'p1', name: 'Curso A', code: 'CA', price: '120' },
          { id: 'p2', name: 'Otro', code: 'OT', price: '90' },
        ],
        w_id_variation: null,
        a_fecha: null,
        students_count: 0,
        organization: null,
        person: null,
        fundae_label: null,
        po: null,
      },
    ];

    const product: ProductInfo = {
      id: 'pr1',
      id_woo: null,
      name: 'Curso A',
      code: 'CA',
      category: null,
      hora_inicio: null,
      hora_fin: null,
      default_variant_start: null,
      default_variant_end: null,
      default_variant_stock_status: null,
      default_variant_stock_quantity: null,
      default_variant_price: null,
      variants: [],
    };

    expect(findDealProductPriceForProduct(deals, product)).toBe('120');

    const productWithoutCode = { ...product, code: null, name: 'Desconocido' };
    expect(findDealProductPriceForProduct(deals, productWithoutCode)).toBe('120');
  });
});

describe('buildVariantGroups', () => {
  it('groups variants by location and month in alphabetical order', () => {
    const variants: VariantInfo[] = [
      sampleVariant({ id: '1', name: 'Madrid 10/01/2025', date: '2025-01-10', sede: 'Madrid' }),
      sampleVariant({ id: '2', name: 'Barcelona 01/03/2025', date: '2025-03-01', sede: 'Barcelona' }),
      sampleVariant({ id: '3', name: 'Madrid 20/02/2025', date: '2025-02-20', sede: 'Madrid' }),
    ];

    const groups = buildVariantGroups(variants);
    expect(groups.map((group) => group.label)).toEqual(['Barcelona', 'Madrid']);
    expect(groups[0].variantsByMonth[0].label).toBe('Marzo 2025');
    expect(groups[1].variantsByMonth[0].label).toBe('Enero 2025');
    expect(groups[1].variantsByMonth[1].label).toBe('Febrero 2025');
  });
});
