// backend/functions/products-variants.ts
import type { Prisma } from '@prisma/client';

import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import { toMadridISOString } from './_shared/timezone';

type VariantRecord = {
  id: string;
  id_woo: bigint;
  name: string | null;
  status: string | null;
  price: Prisma.Decimal | string | null;
  stock: number | null;
  stock_status: string | null;
  sede: string | null;
  date: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

type ProductRecord = {
  id: string;
  id_woo: bigint | null;
  name: string | null;
  code: string | null;
  category: string | null;
  variants: VariantRecord[];
};

function normalizeVariant(record: VariantRecord) {
  const price = record.price == null ? null : typeof record.price === 'string' ? record.price : record.price.toString();

  return {
    id: record.id,
    id_woo: record.id_woo?.toString(),
    name: record.name ?? null,
    status: record.status ?? null,
    price,
    stock: record.stock ?? null,
    stock_status: record.stock_status ?? null,
    sede: record.sede ?? null,
    date: toMadridISOString(record.date),
    created_at: toMadridISOString(record.created_at),
    updated_at: toMadridISOString(record.updated_at),
  } as const;
}

function normalizeProduct(record: ProductRecord) {
  return {
    id: record.id,
    id_woo: record.id_woo ? record.id_woo.toString() : null,
    name: record.name ?? null,
    code: record.code ?? null,
    category: record.category ?? null,
    variants: record.variants.map(normalizeVariant),
  } as const;
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    if (event.httpMethod !== 'GET') {
      return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
    }

    const prisma = getPrisma();

    const productsRaw = await prisma.products.findMany({
      where: {
        id_woo: { not: null },
        variants: { some: {} },
      },
      select: {
        id: true,
        id_woo: true,
        name: true,
        code: true,
        category: true,
        variants: {
          orderBy: [
            { date: 'asc' },
            { name: 'asc' },
          ],
          select: {
            id: true,
            id_woo: true,
            name: true,
            status: true,
            price: true,
            stock: true,
            stock_status: true,
            sede: true,
            date: true,
            created_at: true,
            updated_at: true,
          },
        },
      },
      orderBy: [{ name: 'asc' }],
    });

    const products = productsRaw.map(normalizeProduct);

    return successResponse({ products });
  } catch (error) {
    console.error('[products-variants] handler error', error);
    return errorResponse('UNEXPECTED_ERROR', 'Se ha producido un error inesperado', 500);
  }
};
