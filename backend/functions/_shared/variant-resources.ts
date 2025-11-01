// backend/functions/_shared/variant-resources.ts
import {
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
} from '@prisma/client/runtime/library';

let variantResourceColumnsSupported: boolean | null = null;

const VARIANT_RESOURCE_ERROR_PATTERNS = [
  /unknown (?:arg|field).*?(trainer_id|sala_id|unidad_movil_id)/i,
  /select\.(trainer_id|sala_id|unidad_movil_id)/i,
  /column (?:["'`\w]+\.)*["'`]*(trainer_id|sala_id|unidad_movil_id)["'`]* does not exist/i,
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
  // Errores Prisma conocidos (P2021/P2022) -> columna inexistente
  if (error instanceof PrismaClientKnownRequestError) {
    if ((error as any).code === 'P2021' || (error as any).code === 'P2022') {
      // meta está poco tipado; protegemos el acceso
      const meta = (error as any).meta as { column_name?: unknown } | undefined;
      const columnName =
        typeof meta?.column_name === 'string' ? meta.column_name : '';
      if (columnName) {
        return /(trainer_id|sala_id|unidad_movil_id)/i.test(columnName);
      }
      // Algunos drivers no rellenan meta -> asumimos error de columna
      return true;
    }
  }

  // Errores Prisma desconocidos -> comprobamos por mensaje
  {
  const message = (error as Error).message ?? '';
  if (typeof message === 'string' && message) {
    return VARIANT_RESOURCE_ERROR_PATTERNS.some((p) => p.test(message));
  }
}

  // Cualquier otro error -> comprobamos por mensaje
  if (error instanceof Error) {
    return VARIANT_RESOURCE_ERROR_PATTERNS.some((p) => p.test(error.message));
  }

  return false;
}
