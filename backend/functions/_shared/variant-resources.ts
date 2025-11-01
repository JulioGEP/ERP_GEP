// backend/functions/_shared/variant-resources.ts
import {
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
} from '@prisma/client/runtime/library';

let variantResourceColumnsSupported: boolean | null = null;

const VARIANT_RESOURCE_ERROR_PATTERNS = [
  /unknown (?:arg|field).*?(trainer|sala|unidad(?:_movil)?)(_id)?/i,
  /select\.(trainer|sala|unidad(?:_movil)?)(_id)?/i,
  /include\.(trainer|sala|unidad(?:_movil)?)/i,
  /column (?:["'`\w]+\.)*["'`]*(trainer|sala|unidad(?:_movil)?)(_id)?["'`]* does not exist/i,
  /no such column: (trainer|sala|unidad(?:_movil)?)(_id)?/i,
  /Unknown column ['`"]?(trainer|sala|unidad(?:_movil)?)(_id)?['`"]?/i,
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
      const columnName = typeof meta?.column_name === 'string' ? meta.column_name : '';
      if (columnName) {
        return VARIANT_RESOURCE_ERROR_PATTERNS.some((pattern) => pattern.test(columnName));
      }
      // Algunos drivers no rellenan meta -> asumimos error de columna
      return true;
    }
  }

  // Prisma no tipa todos los errores de validación -> comprobamos por mensaje
  if (error instanceof PrismaClientUnknownRequestError) {
    return VARIANT_RESOURCE_ERROR_PATTERNS.some((pattern) => pattern.test(error.message));
  }

  // Cualquier otro error -> comprobamos por mensaje
  if (error instanceof Error) {
    return VARIANT_RESOURCE_ERROR_PATTERNS.some((pattern) => pattern.test(error.message));
  }

  return false;
}
