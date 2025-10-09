// backend/functions/_lib/resource-conflicts.ts
import type { PrismaClient } from '@prisma/client';
import { toMadridISOString } from '../_shared/timezone';

const ACTIVE_STATUSES = new Set(['Borrador', 'Planificada', 'Suspendido']);

export type ResourceConflictDetail = {
  session_id: string;
  deal_id: string;
  deal_title: string | null;
  organization_name: string | null;
  product_code: string | null;
  product_name: string | null;
  inicio: string | null;
  fin: string | null;
};

export type ResourceConflictSummary = {
  resource_type: 'sala' | 'formador' | 'unidad_movil';
  resource_id: string;
  resource_label?: string | null;
  conflicts: ResourceConflictDetail[];
};

type TimeRangeInput = {
  start: Date;
  end: Date;
  excludeSessionId?: string | null;
};

type ConflictSessionSelection = {
  session_id: string;
  start_at: Date | null;
  end_at: Date | null;
  deal_id: string;
  status: string;
  deal: {
    title: string | null;
    organization: { name: string | null } | null;
  } | null;
  deal_product: { code: string | null; name: string | null } | null;
};

function normalizeConflictDetail(session: ConflictSessionSelection): ResourceConflictDetail {
  return {
    session_id: session.session_id,
    deal_id: session.deal_id,
    deal_title: session.deal?.title ?? null,
    organization_name: session.deal?.organization?.name ?? null,
    product_code: session.deal_product?.code ?? null,
    product_name: session.deal_product?.name ?? null,
    inicio: toMadridISOString(session.start_at),
    fin: toMadridISOString(session.end_at),
  };
}

function isValidStatus(status: string | null | undefined): boolean {
  return status != null ? ACTIVE_STATUSES.has(status) : true;
}

export async function findRoomsConflicts(
  prisma: PrismaClient,
  roomIds: string[],
  range: TimeRangeInput
): Promise<Map<string, ResourceConflictDetail[]>> {
  const map = new Map<string, ResourceConflictDetail[]>();
  if (!roomIds.length) return map;

  const rows = await prisma.deal_sessions.findMany({
    where: {
      session_id: range.excludeSessionId
        ? { not: range.excludeSessionId }
        : undefined,
      sala_id: { in: roomIds },
      status: { in: Array.from(ACTIVE_STATUSES) },
      start_at: { not: null, lt: range.end },
      end_at: { not: null, gt: range.start },
    },
    select: {
      session_id: true,
      sala_id: true,
      start_at: true,
      end_at: true,
      deal_id: true,
      status: true,
      deal: {
        select: {
          title: true,
          organization: { select: { name: true } },
        },
      },
      deal_product: {
        select: { code: true, name: true },
      },
    },
  });

  for (const row of rows) {
    if (!row.sala_id || !isValidStatus(row.status)) continue;
    const conflicts = map.get(row.sala_id) ?? [];
    conflicts.push(
      normalizeConflictDetail({
        session_id: row.session_id,
        start_at: row.start_at,
        end_at: row.end_at,
        deal_id: row.deal_id,
        status: row.status,
        deal: row.deal,
        deal_product: row.deal_product,
      })
    );
    map.set(row.sala_id, conflicts);
  }

  return map;
}

export async function findTrainersConflicts(
  prisma: PrismaClient,
  trainerIds: string[],
  range: TimeRangeInput
): Promise<Map<string, ResourceConflictDetail[]>> {
  const map = new Map<string, ResourceConflictDetail[]>();
  if (!trainerIds.length) return map;

  const rows = await prisma.deal_session_trainers.findMany({
    where: {
      trainer_id: { in: trainerIds },
      session: {
        session_id: range.excludeSessionId
          ? { not: range.excludeSessionId }
          : undefined,
        status: { in: Array.from(ACTIVE_STATUSES) },
        start_at: { not: null, lt: range.end },
        end_at: { not: null, gt: range.start },
      },
    },
    select: {
      trainer_id: true,
      session: {
        select: {
          session_id: true,
          start_at: true,
          end_at: true,
          deal_id: true,
          status: true,
          deal: {
            select: {
              title: true,
              organization: { select: { name: true } },
            },
          },
          deal_product: {
            select: { code: true, name: true },
          },
        },
      },
    },
  });

  for (const row of rows) {
    const session = row.session;
    if (!session || !isValidStatus(session.status)) continue;
    const conflicts = map.get(row.trainer_id) ?? [];
    conflicts.push(
      normalizeConflictDetail({
        session_id: session.session_id,
        start_at: session.start_at,
        end_at: session.end_at,
        deal_id: session.deal_id,
        status: session.status,
        deal: session.deal,
        deal_product: session.deal_product,
      })
    );
    map.set(row.trainer_id, conflicts);
  }

  return map;
}

export async function findMobileUnitsConflicts(
  prisma: PrismaClient,
  unidadIds: string[],
  range: TimeRangeInput
): Promise<Map<string, ResourceConflictDetail[]>> {
  const map = new Map<string, ResourceConflictDetail[]>();
  if (!unidadIds.length) return map;

  const rows = await prisma.deal_session_mobile_units.findMany({
    where: {
      unidad_id: { in: unidadIds },
      session: {
        session_id: range.excludeSessionId
          ? { not: range.excludeSessionId }
          : undefined,
        status: { in: Array.from(ACTIVE_STATUSES) },
        start_at: { not: null, lt: range.end },
        end_at: { not: null, gt: range.start },
      },
    },
    select: {
      unidad_id: true,
      session: {
        select: {
          session_id: true,
          start_at: true,
          end_at: true,
          deal_id: true,
          status: true,
          deal: {
            select: {
              title: true,
              organization: { select: { name: true } },
            },
          },
          deal_product: {
            select: { code: true, name: true },
          },
        },
      },
    },
  });

  for (const row of rows) {
    const session = row.session;
    if (!session || !isValidStatus(session.status)) continue;
    const conflicts = map.get(row.unidad_id) ?? [];
    conflicts.push(
      normalizeConflictDetail({
        session_id: session.session_id,
        start_at: session.start_at,
        end_at: session.end_at,
        deal_id: session.deal_id,
        status: session.status,
        deal: session.deal,
        deal_product: session.deal_product,
      })
    );
    map.set(row.unidad_id, conflicts);
  }

  return map;
}
