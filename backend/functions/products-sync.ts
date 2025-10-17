// backend/functions/products-sync.ts
import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import {
  extractProductCatalogAttributes,
  listAllProducts,
} from './_shared/pipedrive';

const CATEGORY_FILTER = 'formación';
const TYPE_FIELD_HASH = '5bad94030bb7917c186f3238fb2cd8f7a91cf30b';

function normalizeText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function normaliseCategory(value: string | null | undefined) {
  if (!value) return null;
  return value.trim();
}

function isMatchingCategory(value: string | null | undefined) {
  if (!value) return false;
  return value.trim().toLowerCase() === CATEGORY_FILTER;
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    if (event.httpMethod !== 'POST') {
      return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);
    }

    const prisma = getPrisma();
    const rawProducts = await listAllProducts();

    const mappedProducts = [] as {
      id_pipe: string;
      name: string | null;
      code: string | null;
      category: string | null;
      type: string | null;
      active: boolean;
    }[];

    for (const raw of rawProducts) {
      const idPipe = normalizeText(raw?.id);
      if (!idPipe) {
        continue;
      }

      const attributes = await extractProductCatalogAttributes(raw);
      const categoryLabel = normaliseCategory(attributes.category ?? normalizeText(raw?.category));
      if (!isMatchingCategory(categoryLabel)) {
        continue;
      }

      const typeFromAttributes = normalizeText(attributes.type);
      const typeRawValue = normalizeText(raw?.[TYPE_FIELD_HASH]);
      const typeLabel = typeFromAttributes ?? typeRawValue;

      mappedProducts.push({
        id_pipe: idPipe,
        name: normalizeText(raw?.name),
        code: normalizeText(attributes.code ?? raw?.code),
        category: categoryLabel,
        type: typeLabel,
        active: raw?.selectable === undefined ? true : Boolean(raw.selectable),
      });
    }

    if (mappedProducts.length === 0) {
      await prisma.products.updateMany({
        data: { active: false, updated_at: new Date() },
      });

      return successResponse({
        ok: true,
        summary: {
          fetched: rawProducts.length,
          imported: 0,
          created: 0,
          updated: 0,
          deactivated: 'all',
        },
      });
    }

    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.products.findMany({
        select: { id: true, id_pipe: true, active: true },
      });
      const existingByPipe = new Map(existing.map((product) => [product.id_pipe, product]));

      let created = 0;
      let updated = 0;
      const processed = new Set<string>();

      for (const product of mappedProducts) {
        const existingProduct = existingByPipe.get(product.id_pipe);
        const data = {
          name: product.name,
          code: product.code,
          category: product.category,
          type: product.type,
          active: product.active,
          updated_at: now,
        };

        await tx.products.upsert({
          where: { id_pipe: product.id_pipe },
          create: {
            id_pipe: product.id_pipe,
            name: product.name,
            code: product.code,
            category: product.category,
            type: product.type,
            active: product.active,
            updated_at: now,
          },
          update: data,
        });

        if (existingProduct) {
          updated += 1;
        } else {
          created += 1;
        }
        processed.add(product.id_pipe);
      }

      const missing = existing
        .filter((product) => !processed.has(product.id_pipe))
        .map((product) => product.id_pipe);

      let deactivated = 0;
      if (missing.length > 0) {
        const updateResult = await tx.products.updateMany({
          where: { id_pipe: { in: missing } },
          data: { active: false, updated_at: now },
        });
        deactivated = updateResult.count;
      }

      return { created, updated, deactivated };
    });

    return successResponse({
      ok: true,
      summary: {
        fetched: rawProducts.length,
        imported: mappedProducts.length,
        created: result.created,
        updated: result.updated,
        deactivated: result.deactivated,
      },
    });
  } catch (error) {
    console.error('[products-sync] handler error', error);
    return errorResponse('UNEXPECTED_ERROR', 'Se ha producido un error inesperado', 500);
  }
};
