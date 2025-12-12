import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { errorResponse } from './response';

const APPLICABLE_PREFIXES = ['form-', 'prev-', 'pci-'];
const SINGLE_SESSION_PIPE_IDS = new Set(['1', '240', '241']);

type DealProductRecord = {
  id: string;
  deal_id: string | null;
  quantity: unknown;
  name: string | null;
  code: string | null;
  id_pipe?: string | null;
};

export function hasApplicableCode(code: unknown): boolean {
  if (!code) return false;
  const normalized = String(code).toLowerCase();
  return APPLICABLE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function hasPrevencionPrefix(name: unknown, code: unknown): boolean {
  const values = [name, code]
    .map((value) => (value == null ? null : String(value).trim().toLowerCase()))
    .filter((value): value is string => Boolean(value));

  return values.some((value) => value.startsWith('prev-'));
}

export function toNonNegativeInt(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.floor(num);
}

export async function reindexSessionNames(
  tx: Prisma.TransactionClient,
  dealProductId: string,
  baseName: string,
) {
  const base = baseName.trim().length ? baseName.trim() : 'Sesión';
  const sesiones: { id: string; nombre_cache: string | null }[] = await tx.sesiones.findMany({
    where: { deal_product_id: dealProductId },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    select: { id: true, nombre_cache: true },
  });

  const updates: Array<ReturnType<typeof tx.sesiones.update>> = [];
  sesiones.forEach((session: { id: string; nombre_cache: string | null }, index: number) => {
    const expected = `${base} #${index + 1}`;
    if (session.nombre_cache === expected) return;
    updates.push(
      tx.sesiones.update({
        where: { id: session.id },
        data: { nombre_cache: expected },
      }),
    );
  });

  if (updates.length) {
    await Promise.all(updates);
  }

  return sesiones.length;
}

function buildNombreBase(name: unknown, code: unknown): string {
  const parts = [name, code]
    .map((value) => (value == null ? null : String(value).trim()))
    .filter((value): value is string => Boolean(value));
  if (!parts.length) {
    return 'Sesión';
  }
  return parts.join(' – ');
}

async function syncSessionsForProduct(
  tx: Prisma.TransactionClient,
  dealId: string,
  product: DealProductRecord,
  defaultAddress: string | null,
) {
  const productCatalogId = (() => {
    if (!product?.id) return null;
    const parts = String(product.id).split('_');
    return parts.length >= 2 ? parts[parts.length - 1] ?? null : null;
  })();

  const normalizedPipeId = product.id_pipe == null ? null : String(product.id_pipe).trim();
  const isSingleSessionProduct =
    typeof product.name === 'string' &&
    product.name.trim().toLowerCase() === 'formación esi en campo de fuego 6h' &&
    ((typeof product.code === 'string' && product.code.trim().toLowerCase() === '1') ||
      (typeof productCatalogId === 'string' && productCatalogId.trim().toLowerCase() === '1'));

  const targetQuantity =
    isSingleSessionProduct ||
    (hasApplicableCode(product.code) && normalizedPipeId && SINGLE_SESSION_PIPE_IDS.has(normalizedPipeId)) ||
    hasPrevencionPrefix(product.name, product.code)
      ? 1
      : toNonNegativeInt(product.quantity, 0);
  const baseName = buildNombreBase(product.name, product.code);

  const existing = await tx.sesiones.findMany({
    where: { deal_product_id: product.id },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });

  let created = 0;
  if (existing.length < targetQuantity) {
    const totalToCreate = targetQuantity - existing.length;
    for (let index = 0; index < totalToCreate; index += 1) {
      await tx.sesiones.create({
        data: {
          id: randomUUID(),
          deal_id: dealId,
          deal_product_id: product.id,
          nombre_cache: `${baseName} #${existing.length + index + 1}`,
          direccion: defaultAddress ?? '',
          estado: 'BORRADOR',
        } as any,
      });
      created += 1;
    }
  }

  await reindexSessionNames(tx, product.id, baseName);

  return { created, deleted: 0 };
}

export async function generateSessionsForDeal(tx: Prisma.TransactionClient, dealId: string) {
  const deal = await tx.deals.findUnique({
    where: { deal_id: dealId },
    select: {
      deal_id: true,
      training_address: true,
      deal_products: {
        select: { id: true, deal_id: true, quantity: true, name: true, code: true },
      },
    },
  });

  if (!deal) {
    return { error: errorResponse('NOT_FOUND', 'Presupuesto no encontrado', 404) } as const;
  }

  const applicableProducts: DealProductRecord[] = (deal.deal_products ?? []).filter(
    (product: unknown): product is DealProductRecord =>
      typeof (product as any)?.code === 'string' && hasApplicableCode((product as any).code),
  );

  const productNames = Array.from(
    new Set(
      applicableProducts
        .map((product) => (typeof product?.name === 'string' ? product.name.trim() : ''))
        .filter((name) => name.length > 0),
    ),
  );

  const catalogProducts = productNames.length
    ? await tx.products.findMany({
        where: { name: { in: productNames } },
        select: { name: true, id_pipe: true },
      })
    : [];

  const normalizeName = (value: unknown): string | null => {
    if (value == null) return null;
    const name = String(value).trim();
    if (!name.length) return null;
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  };

  const normalizeIdPipe = (value: unknown): string | null => {
    if (value == null) return null;
    const id = String(value).trim();
    return id.length ? id : null;
  };

  const idPipeByName = new Map<string, string>();
  catalogProducts.forEach((product) => {
    const nameKey = normalizeName(product?.name);
    const idPipe = normalizeIdPipe(product?.id_pipe);
    if (!nameKey || !idPipe || idPipeByName.has(nameKey)) return;
    idPipeByName.set(nameKey, idPipe);
  });

  const applicableWithPipe: DealProductRecord[] = applicableProducts.map((product) => {
    const nameKey = normalizeName(product?.name);
    const resolvedPipeId = nameKey ? idPipeByName.get(nameKey) ?? null : null;
    return { ...product, id_pipe: resolvedPipeId };
  });

  const applicableIds = applicableWithPipe.map((product: DealProductRecord) => product.id);

  if (applicableIds.length === 0) {
    const result = await tx.sesiones.deleteMany({ where: { deal_id: dealId } });
    return { count: 0, created: 0, deleted: result.count } as const;
  }

  const pruneResult = await tx.sesiones.deleteMany({
    where: {
      deal_id: dealId,
      NOT: { deal_product_id: { in: applicableIds } },
    },
  });

  const syncResults = await Promise.all(
    applicableWithPipe.map((product: DealProductRecord) =>
      syncSessionsForProduct(tx, deal.deal_id, product, deal.training_address ?? null),
    ),
  );

  const created = syncResults.reduce((sum, result) => sum + result.created, 0);
  const deleted =
    pruneResult.count + syncResults.reduce((sum, result) => sum + result.deleted, 0);

  const count = await tx.sesiones.count({ where: { deal_id: deal.deal_id } });
  return { count, created, deleted } as const;
}
