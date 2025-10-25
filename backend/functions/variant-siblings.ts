import type { Handler } from '@netlify/functions';

import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';

function toTrimmed(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const trimmed = String(value).trim();
  if (!trimmed.length) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }
  return parsed.toISOString().slice(0, 10);
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return preflightResponse();
  }

  if (event.httpMethod !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
  }

  const params = event.queryStringParameters ?? {};
  const rawVariantWooId = toTrimmed(params.variantWooId ?? params.variant_woo_id ?? null);
  const rawParentWooId = toTrimmed(params.parentWooId ?? params.parent_woo_id ?? null);

  if (!rawVariantWooId && !rawParentWooId) {
    return errorResponse(
      'VALIDATION_ERROR',
      'Debes indicar el identificador de la variante o del producto padre.',
      400,
    );
  }

  let variantWooIdBigInt: bigint | null = null;
  if (rawVariantWooId) {
    try {
      variantWooIdBigInt = BigInt(rawVariantWooId);
    } catch (error) {
      return errorResponse('VALIDATION_ERROR', 'El identificador de la variante es inválido.', 400);
    }
  }

  let parentWooIdBigInt: bigint | null = null;
  if (rawParentWooId) {
    try {
      parentWooIdBigInt = BigInt(rawParentWooId);
    } catch (error) {
      return errorResponse('VALIDATION_ERROR', 'El identificador del producto padre es inválido.', 400);
    }
  }

  try {
    const prisma = await getPrisma();

    let parentProduct: { id: string | null; wooId: string | null; name: string | null } | null = null;

    if (!parentWooIdBigInt) {
      if (!variantWooIdBigInt) {
        return errorResponse(
          'VALIDATION_ERROR',
          'No se pudo determinar el producto padre de la variante.',
          400,
        );
      }

      const variantRecord = await prisma.variants.findFirst({
        where: { id_woo: variantWooIdBigInt },
        select: {
          id_padre: true,
          product: { select: { id: true, id_woo: true, name: true } },
        },
      });

      if (!variantRecord) {
        return errorResponse('NOT_FOUND', 'No se encontró la variante solicitada.', 404);
      }

      parentWooIdBigInt = variantRecord.id_padre;
      if (!parentWooIdBigInt) {
        return errorResponse(
          'VALIDATION_ERROR',
          'La variante no tiene un producto padre asociado.',
          400,
        );
      }

      if (variantRecord.product) {
        parentProduct = {
          id: variantRecord.product.id,
          wooId: variantRecord.product.id_woo?.toString() ?? null,
          name: variantRecord.product.name ?? null,
        };
      }
    }

    if (!parentWooIdBigInt) {
      return errorResponse(
        'VALIDATION_ERROR',
        'No se pudo determinar el producto padre de la variante.',
        400,
      );
    }

    if (!parentProduct) {
      const productRecord = await prisma.products.findFirst({
        where: { id_woo: parentWooIdBigInt },
        select: { id: true, id_woo: true, name: true },
      });

      if (productRecord) {
        parentProduct = {
          id: productRecord.id,
          wooId: productRecord.id_woo?.toString() ?? null,
          name: productRecord.name ?? null,
        };
      }
    }

    type VariantRow = {
      id: string;
      id_woo: bigint | null;
      id_padre: bigint | null;
      name: string | null;
      date: Date | string | null;
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const variants = (await prisma.variants.findMany({
      where: {
        id_padre: parentWooIdBigInt,
        date: { gt: today },
      },
      select: {
        id: true,
        id_woo: true,
        id_padre: true,
        name: true,
        date: true,
      },
      orderBy: [{ date: 'asc' }, { name: 'asc' }],
    })) as VariantRow[];

    const normalizedVariants = variants.map((variant) => ({
      id: variant.id,
      wooId: variant.id_woo?.toString() ?? null,
      parentWooId: variant.id_padre?.toString() ?? null,
      name: variant.name ?? null,
      date: normalizeDate(variant.date),
    }));

    return successResponse({
      parent: parentProduct,
      variants: normalizedVariants,
    });
  } catch (error) {
    console.error('[variant-siblings] handler error', error);
    return errorResponse('UNEXPECTED_ERROR', 'Se ha producido un error inesperado', 500);
  }
};
