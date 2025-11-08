// backend/functions/trainer-dashboard.ts
import { createHttpHandler } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { nowInMadridISO } from './_shared/timezone';

type TrainerDashboardMetrics = {
  totalAssigned: number;
  companySessions: number;
  gepServicesSessions: number;
  openTrainingVariants: number;
};

type TrainerDashboardSession = {
  sessionId: string;
  budgetNumber: string | null;
  sessionTitle: string | null;
  productName: string | null;
  address: string | null;
  mobileUnits: Array<{ id: string; name: string | null; plate: string | null }>;
};

type SessionRecord = {
  id: string;
  nombre_cache: string | null;
  direccion: string | null;
  deals: { deal_id: string | null; pipeline_id: string | null } | null;
  deal_products: { name: string | null } | null;
  sesion_unidades: Array<{
    unidad_movil_id: string | null;
    unidades_moviles: { unidad_id: string | null; name: string | null; matricula: string | null } | null;
  }> | null;
};

type VariantRecord = {
  id: string;
};

const PIPELINE_LABELS_COMPANY = [
  'formacion empresa',
  'formacion empresas',
  'formación empresa',
  'formación empresas',
];

const PIPELINE_LABELS_GEP = ['gep services'];

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
    const empty: { metrics: TrainerDashboardMetrics; sessions: TrainerDashboardSession[]; generatedAt: string } = {
      metrics: {
        totalAssigned: 0,
        companySessions: 0,
        gepServicesSessions: 0,
        openTrainingVariants: 0,
      },
      sessions: [],
      generatedAt: nowInMadridISO(),
    };
    return successResponse(empty);
  }

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
    },
    orderBy: [{ fecha_inicio_utc: 'asc' }],
  })) as SessionRecord[];

  const variantPrimaryRecords = (await prisma.variants.findMany({
    where: { trainer_id: trainer.trainer_id },
    select: { id: true },
  })) as VariantRecord[];

  const variantIds = new Set<string>(variantPrimaryRecords.map((variant) => variant.id));

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

  const companySessions = sessions.filter((session) => {
    const pipeline = normalizePipeline(session.deals?.pipeline_id ?? null);
    return pipeline !== null && PIPELINE_LABELS_COMPANY.includes(pipeline);
  }).length;

  const gepServicesSessions = sessions.filter((session) => {
    const pipeline = normalizePipeline(session.deals?.pipeline_id ?? null);
    return pipeline !== null && PIPELINE_LABELS_GEP.includes(pipeline);
  }).length;

  const openTrainingVariants = variantIds.size;

  const totalAssigned = companySessions + gepServicesSessions + openTrainingVariants;

  const sessionRows: TrainerDashboardSession[] = sessions.map((session) => {
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
    },
    sessions: sessionRows,
    generatedAt: nowInMadridISO(),
  });
});
