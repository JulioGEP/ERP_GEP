// @ts-nocheck
// backend/functions/_shared/variant-resources.ts
import { Prisma } from '@prisma/client';

let variantResourceColumnsSupported: boolean | null = null;

const VARIANT_RESOURCE_ERROR_PATTERNS = [
  /unknown (?:arg|field).*?(trainer_id|sala_id|unidad_movil_id)/i,
  /select\.(trainer_id|sala_id|unidad_movil_id)/i,
  /column ["'`]*(trainer_id|sala_id|unidad_movil_id)["'`]* does not exist/i,
  /no such column: (trainer_id|sala_id|unidad_movil_id)/i,
  /Unknown column ['`"]?(trainer_id|sala_id|unidad_movil_id)['`"]?/i,
];

export function getVariantResourceColumnsSupport(): boolean | null {
  return variantResourceColumnsSupported;
}

export function setVariantResourceColumnsSupport(supported: boolean): void {
  variantResourceColumnsSupported = supported;
}

export function isVariantResourceColumnError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2021' || error.code === 'P2022') {
      const columnName = typeof error.meta?.column_name === 'string' ? error.meta.column_name : '';
      if (columnName) {
        return /(trainer_id|sala_id|unidad_movil_id)/i.test(columnName);
      }
      return true;
    }
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    const message = (error as Error).message;
    return VARIANT_RESOURCE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
  }

  if (error instanceof Error) {
    return VARIANT_RESOURCE_ERROR_PATTERNS.some((pattern) => pattern.test(error.message));
  }

  return false;
}

