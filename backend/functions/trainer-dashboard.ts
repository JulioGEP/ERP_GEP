// backend/functions/trainer-dashboard.ts
import { createHttpHandler } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { nowInMadridISO, toMadridISOString } from './_shared/timezone';

type TrainerDashboardMetrics = {
  totalAssigned: number;
  companySessions: number;
  gepServicesSessions: number;
  openTrainingVariants: number;
  pendingConfirmations: number;
};

type TrainerDashboardSession = {
  sessionId: string;
  budgetNumber: string | null;
  date: string | null;
  sessionTitle: string | null;
  productName: string | null;
  address: string | null;
  mobileUnits: Array<{ id: string; name: string | null; plate: string | null }>;
};

type TrainerDashboardVariant = {
  variantId: string;
  productName: string | null;
  site: string | null;
  date: string | null;
  mobileUnit: { id: string; name: string | null; plate: string | null } | null;
  studentCount: number;
};

type SessionRecord = {
  id: string;
  fecha_inicio_utc: Date | null;
  nombre_cache: string | null;
  direccion: string | null;
  deals: { deal_id: string | null; pipeline_id: string | null } | null;
  deal_products: { name: string | null } | null;
  sesion_unidades: Array<{
    unidad_movil_id: string | null;
    unidades_moviles: { unidad_id: string | null; name: string | null; matricula: string | null } | null;
  }> | null;
  trainer_session_invites: Array<{ trainer_id: string | null; status: string | null }> | null;
};

type VariantRecord = {
  id: string;
};

type VariantInviteRecord = {
  variant_id: unknown;
  status: unknown;
};

type VariantDetailRecord = {
  id: string;
  id_woo: unknown;
  sede: string | null;
  date: Date | null;
  unidad_movil_id: string | null;
  products: { name: string | null } | null;
  unidades_moviles: { unidad_id: string | null; name: string | null; matricula: string | null } | null;
};

const PIPELINE_LABELS_COMPANY = [
  'formacion empresa',
  'formacion empresas',
  'formación empresa',
  'formación empresas',
];

const PIPELINE_LABELS_GEP = ['gep services', 'preventivos', 'pci'];

function normalizePipeline(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  return trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isMissingRelationError(error: unknown, relation: string): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message || '';
  const pattern = new RegExp(`\\b${relation}\\b`, 'i');
  return pattern.test(message);
}

function toMaybeString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return String(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value && typeof value === 'object' && 'toString' in value && typeof (value as any).toString === 'function') {
    const result = (value as { toString: () => unknown }).toString();
    if (typeof result !== 'string') return null;
    const trimmed = result.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
}

function normalizeTrainerInviteStatus(value: unknown): 'PENDING' | 'CONFIRMED' | 'DECLINED' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'PENDING' || normalized === 'CONFIRMED' || normalized === 'DECLINED') {
    return normalized;
  }
  return null;
}

function madridDateKey(value: Date | string | null | undefined): string | null {
  const iso = toMadridISOString(value);
  if (!iso) return null;
  return iso.slice(0, 10);
}

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ['Formador'] });

  if ('error' in auth) {
    return auth.error;
  }

  const trainer = await prisma.trainers.findUnique({
    where: { user_id: auth.user.id },
    select: { trainer_id: true },
  });

  if (!trainer) {
    const empty: {
      metrics: TrainerDashboardMetrics;
      sessions: TrainerDashboardSession[];
      variants: TrainerDashboardVariant[];
      generatedAt: string;
    } = {
      metrics: {
        totalAssigned: 0,
        companySessions: 0,
        gepServicesSessions: 0,
        openTrainingVariants: 0,
        pendingConfirmations: 0,
      },
      sessions: [],
      variants: [],
      generatedAt: nowInMadridISO(),
    };
    return successResponse(empty);
  }

  const trainerId = toMaybeString(trainer.trainer_id) ?? trainer.trainer_id;
  const todayMadridKey = madridDateKey(nowInMadridISO());

  const pipelineFilter = {
    OR: [...PIPELINE_LABELS_COMPANY, ...PIPELINE_LABELS_GEP].map((label) => ({
      pipeline_id: { equals: label, mode: 'insensitive' as const },
    })),
  };

  const sessions = (await prisma.sesiones.findMany({
    where: {
      sesion_trainers: { some: { trainer_id: trainer.trainer_id } },
      deals: pipelineFilter,
    },
    select: {
      id: true,
      fecha_inicio_utc: true,
      nombre_cache: true,
      direccion: true,
      deals: { select: { deal_id: true, pipeline_id: true } },
      deal_products: { select: { name: true } },
      sesion_unidades: {
        select: {
          unidad_movil_id: true,
          unidades_moviles: { select: { unidad_id: true, name: true, matricula: true } },
        },
      },
      trainer_session_invites: { select: { trainer_id: true, status: true } },
    },
    orderBy: [{ fecha_inicio_utc: 'asc' }],
  })) as SessionRecord[];

  const sessionInviteStatuses = new Map<string, ReturnType<typeof normalizeTrainerInviteStatus>>();
  for (const session of sessions) {
    const invites = Array.isArray(session.trainer_session_invites)
      ? session.trainer_session_invites
      : [];
    const match = invites.find((invite) => toMaybeString(invite?.trainer_id) === trainerId);
    const status = match ? normalizeTrainerInviteStatus(match.status) : null;
    if (session.id) {
      sessionInviteStatuses.set(session.id, status);
    }
  }

  const pendingConfirmations = Array.from(sessionInviteStatuses.values()).reduce(
    (total, status) => (status === 'PENDING' ? total + 1 : total),
    0,
  );

  const acceptedSessions = sessions.filter((session) => {
    if (sessionInviteStatuses.get(session.id) !== 'CONFIRMED') return false;
    const sessionDateKey = madridDateKey(session.fecha_inicio_utc);
    if (!todayMadridKey || !sessionDateKey) return false;
    return sessionDateKey >= todayMadridKey;
  });

  const variantPrimaryRecords = (await prisma.variants.findMany({
    where: { trainer_id: trainer.trainer_id },
    select: { id: true },
  })) as VariantRecord[];

  const variantIds = new Set<string>(variantPrimaryRecords.map((variant) => variant.id));

  const variantInviteRecords = (await prisma.variant_trainer_invites.findMany({
    where: { trainer_id: trainer.trainer_id },
    select: { variant_id: true, status: true },
  })) as VariantInviteRecord[];

  const confirmedVariantInviteIds = new Set<string>();
  for (const invite of variantInviteRecords) {
    const variantId = toMaybeString(invite.variant_id);
    if (!variantId) continue;
    const status = normalizeTrainerInviteStatus(invite.status);
    if (status === 'CONFIRMED') {
      confirmedVariantInviteIds.add(variantId);
    }
  }

  confirmedVariantInviteIds.forEach((variantId) => {
    variantIds.add(variantId);
  });

  try {
    const rows = (await prisma.$queryRaw<{ variant_id: string }[]>`
      SELECT variant_id::text AS variant_id
      FROM variant_trainer_links
      WHERE trainer_id = ${trainer.trainer_id}
    `) as Array<{ variant_id: string }>;

    for (const row of rows) {
      if (row.variant_id) {
        variantIds.add(row.variant_id);
      }
    }
  } catch (error) {
    if (!isMissingRelationError(error, 'variant_trainer_links')) {
      throw error;
    }
  }

  const companySessions = acceptedSessions.filter((session) => {
    const pipeline = normalizePipeline(session.deals?.pipeline_id ?? null);
    return pipeline !== null && PIPELINE_LABELS_COMPANY.includes(pipeline);
  }).length;

  const gepServicesSessions = acceptedSessions.filter((session) => {
    const pipeline = normalizePipeline(session.deals?.pipeline_id ?? null);
    return pipeline !== null && PIPELINE_LABELS_GEP.includes(pipeline);
  }).length;

  const eligibleVariantIds = Array.from(variantIds).filter((variantId) =>
    confirmedVariantInviteIds.has(variantId),
  );
  const eligibleVariantIdSet = new Set(eligibleVariantIds);

  const openTrainingVariants = eligibleVariantIdSet.size;

  const totalAssigned = companySessions + gepServicesSessions + openTrainingVariants;

  const variantDetails: TrainerDashboardVariant[] = [];

  if (eligibleVariantIdSet.size) {
    const variantRecords = (await prisma.variants.findMany({
      where: { id: { in: eligibleVariantIds } },
      orderBy: [{ date: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        id_woo: true,
        sede: true,
        date: true,
        unidad_movil_id: true,
        products: { select: { name: true } },
        unidades_moviles: { select: { unidad_id: true, name: true, matricula: true } },
      },
    })) as VariantDetailRecord[];

    const variantWooIds = Array.from(
      new Set(
        variantRecords
          .map((record) => toMaybeString(record.id_woo))
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const studentsCountByVariant = new Map<string, number>();

    if (variantWooIds.length) {
      const dealsWithCounts = await prisma.deals.findMany({
        where: { w_id_variation: { in: variantWooIds } },
        select: {
          w_id_variation: true,
          _count: { select: { alumnos: true } },
        },
      });

      for (const deal of dealsWithCounts as Array<{ w_id_variation: unknown; _count: { alumnos: number } }>) {
        const key = toMaybeString(deal.w_id_variation);
        if (!key) continue;
        const previous = studentsCountByVariant.get(key) ?? 0;
        const count = Number.isFinite(deal._count?.alumnos)
          ? Math.max(0, Math.trunc(deal._count.alumnos))
          : 0;
        studentsCountByVariant.set(key, previous + count);
      }
    }

    for (const record of variantRecords) {
      const variantWooId = toMaybeString(record.id_woo);
      const studentCount = variantWooId ? studentsCountByVariant.get(variantWooId) ?? 0 : 0;

      let mobileUnit: TrainerDashboardVariant['mobileUnit'] = null;
      if (record.unidades_moviles) {
        const unit = record.unidades_moviles;
        const id = toMaybeString(unit.unidad_id) ?? record.unidad_movil_id ?? null;
        if (id) {
          mobileUnit = {
            id,
            name: unit.name ?? null,
            plate: unit.matricula ?? null,
          };
        }
      } else if (record.unidad_movil_id) {
        mobileUnit = {
          id: record.unidad_movil_id,
          name: null,
          plate: null,
        };
      }

      const variantDate = record.date ? record.date.toISOString() : null;
      const variantDateKey = madridDateKey(variantDate);
      if (!todayMadridKey || !variantDateKey || variantDateKey < todayMadridKey) {
        continue;
      }

      variantDetails.push({
        variantId: record.id,
        productName: record.products?.name ?? null,
        site: record.sede ?? null,
        date: variantDate,
        mobileUnit,
        studentCount,
      });
    }
  }

  const sessionRows: TrainerDashboardSession[] = acceptedSessions.map((session) => {
    const mobileUnits: TrainerDashboardSession['mobileUnits'] = [];
    for (const link of session.sesion_unidades ?? []) {
      const unit = link.unidades_moviles ?? null;
      const id = unit?.unidad_id ?? link.unidad_movil_id ?? null;
      if (!id) continue;
      mobileUnits.push({ id, name: unit?.name ?? null, plate: unit?.matricula ?? null });
    }
    return {
      sessionId: session.id,
      budgetNumber: session.deals?.deal_id ?? null,
      date: session.fecha_inicio_utc ? session.fecha_inicio_utc.toISOString() : null,
      sessionTitle: session.nombre_cache ?? null,
      productName: session.deal_products?.name ?? null,
      address: session.direccion ?? null,
      mobileUnits,
    };
  });

  return successResponse({
    metrics: {
      totalAssigned,
      companySessions,
      gepServicesSessions,
      openTrainingVariants,
      pendingConfirmations,
    },
    sessions: sessionRows,
    variants: variantDetails,
    generatedAt: nowInMadridISO(),
  });
});
