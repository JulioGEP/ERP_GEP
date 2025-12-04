import { requestJson, toStringValue } from '../../../api/client';
import {
  normalizeMobileUnitOption,
  normalizeProductVariants,
  normalizeRoomOption,
  normalizeTrainerOption,
  normalizeVariantParent,
  normalizeVariantSibling,
} from './normalizers';
import type {
  MobileUnitOption,
  ProductVariantOption,
  RoomOption,
  TrainerOption,
} from '../../../api/sessions.types';

export type VariantSiblingOption = {
  id: string;
  wooId: string | null;
  parentWooId: string | null;
  name: string | null;
  date: string | null;
};

export type VariantSiblingsResponse = {
  parent: { id: string | null; wooId: string | null; name: string | null } | null;
  variants: VariantSiblingOption[];
};

async function request<T = any>(path: string, init?: RequestInit) {
  return requestJson<T>(path, init);
}

export async function fetchActiveTrainers(): Promise<TrainerOption[]> {
  const data = await request<{ trainers?: unknown[] }>('/trainers');
  const trainers = Array.isArray(data?.trainers) ? (data.trainers as unknown[]) : [];
  return trainers
    .map((trainer) => normalizeTrainerOption(trainer))
    .filter((trainer): trainer is TrainerOption => !!trainer && trainer.activo)
    .sort((a: TrainerOption, b: TrainerOption) => {
      const nameA = `${a.name} ${a.apellido ?? ''}`.trim().toLowerCase();
      const nameB = `${b.name} ${b.apellido ?? ''}`.trim().toLowerCase();
      return nameA.localeCompare(nameB, 'es');
    });
}

export async function fetchRoomsCatalog(): Promise<RoomOption[]> {
  const data = await request<{ rooms?: unknown[] }>('/rooms');
  const rooms = Array.isArray(data?.rooms) ? (data.rooms as unknown[]) : [];
  return rooms
    .map((room) => normalizeRoomOption(room))
    .filter((room): room is RoomOption => !!room)
    .sort((a: RoomOption, b: RoomOption) => a.name.localeCompare(b.name, 'es'));
}

export async function fetchMobileUnitsCatalog(): Promise<MobileUnitOption[]> {
  const data = await request<{ mobileUnits?: unknown[] }>('/mobile-units');
  const units = Array.isArray(data?.mobileUnits) ? (data.mobileUnits as unknown[]) : [];
  return units
    .filter((unit) => (unit as any)?.activo !== false)
    .map((unit) => normalizeMobileUnitOption(unit))
    .filter((unit): unit is MobileUnitOption => !!unit && unit.activo !== false)
    .sort((a: MobileUnitOption, b: MobileUnitOption) => a.name.localeCompare(b.name, 'es'));
}

export async function fetchProductVariants(options?: {
  productIds?: string[];
  variantWooIds?: string[];
}): Promise<ProductVariantOption[]> {
  const data = await request<{ products?: unknown[] }>('/products-variants');
  const products = Array.isArray(data?.products) ? (data.products as unknown[]) : [];
  return normalizeProductVariants(products, options);
}

export async function fetchVariantSiblings(params: {
  variantWooId?: string | null;
  parentWooId?: string | null;
}): Promise<VariantSiblingsResponse> {
  const searchParams = new URLSearchParams();
  const variantId = toStringValue(params.variantWooId);
  const parentId = toStringValue(params.parentWooId);

  if (variantId) {
    searchParams.set('variantWooId', variantId);
  }

  if (parentId) {
    searchParams.set('parentWooId', parentId);
  }

  if (!variantId && !parentId) {
    throw new Error('variantWooId o parentWooId requerido');
  }

  const url = searchParams.toString().length
    ? `/variant-siblings?${searchParams.toString()}`
    : `/variant-siblings`;

  const data = await request<{ variants?: unknown[]; parent?: unknown }>(url);

  const rawVariants = Array.isArray(data?.variants) ? data.variants : [];
  const normalizedVariants = rawVariants
    .map((variant: any) => {
      const normalized = normalizeVariantSibling(variant);
      if (!normalized.id) {
        return null;
      }
      return normalized as VariantSiblingOption;
    })
    .filter((variant): variant is VariantSiblingOption => variant !== null);

  const parent = normalizeVariantParent(data?.parent);

  return { parent, variants: normalizedVariants };
}

export type { TrainerOption, RoomOption, MobileUnitOption, ProductVariantOption };
