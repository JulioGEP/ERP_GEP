// @ts-nocheck
import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { errorResponse } from './response';

const APPLICABLE_PREFIXES = ['form-', 'ces-', 'prev-', 'pci-'];

type DealProductRecord = {
  id: string;
  deal_id: string | null;
  quantity: unknown;
  name: string | null;
  code: string | null;
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
  const sessions = await tx.sessions.findMany({
    where: { deal_product_id: dealProductId },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    select: { id: true, nombre_cache: true },
  });

  const updates: Array<ReturnType<typeof tx.sessions.update>> = [];
  sessions.forEach((session, index) => {
    const expected = `${base} #${index + 1}`;
    if (session.nombre_cache === expected) return;
    updates.push(
      tx.sessions.update({
        where: { id: session.id },
        data: { nombre_cache: expected },
      }),
    );
  });

  if (updates.length) {
    await Promise.all(updates);
  }

  return sessions.length;
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
  const targetQuantity = hasPrevencionPrefix(product.name, product.code)
    ? 1
    : toNonNegativeInt(product.quantity, 0);
  const baseName = buildNombreBase(product.name, product.code);

  const existing = await tx.sessions.findMany({
    where: { deal_product_id: product.id },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });

  let deleted = 0;
  if (existing.length > targetQuantity) {
    const toDelete = existing.slice(targetQuantity);
    if (toDelete.length) {
      const result = await tx.sessions.deleteMany({
        where: { id: { in: toDelete.map(({ id }) => id) } },
      });
      deleted += result.count;
    }
  }

  let created = 0;
  if (existing.length < targetQuantity) {
    const totalToCreate = targetQuantity - existing.length;
    for (let index = 0; index < totalToCreate; index += 1) {
      await tx.sessions.create({
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

  return { created, deleted };
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

  const applicableProducts = (deal.deal_products ?? []).filter((product): product is DealProductRecord =>
    hasApplicableCode(product.code),
  );

  const applicableIds = applicableProducts.map((product) => product.id);

  if (applicableIds.length === 0) {
    const result = await tx.sessions.deleteMany({ where: { deal_id: dealId } });
    return { count: 0, created: 0, deleted: result.count } as const;
  }

  const pruneResult = await tx.sessions.deleteMany({
    where: {
      deal_id: dealId,
      NOT: { deal_product_id: { in: applicableIds } },
    },
  });

  const syncResults = await Promise.all(
    applicableProducts.map((product) =>
      syncSessionsForProduct(tx, deal.deal_id, product, deal.training_address ?? null),
    ),
  );

  const created = syncResults.reduce((sum, result) => sum + result.created, 0);
  const deleted =
    pruneResult.count + syncResults.reduce((sum, result) => sum + result.deleted, 0);

  const count = await tx.sessions.count({ where: { deal_id: deal.deal_id } });
  return { count, created, deleted } as const;
}
