import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { normalizeTrainer, type TrainerRecord } from './_shared/trainers';
import { toMadridISOString } from './_shared/timezone';

type SessionRecord = {
  id: string;
  nombre_cache: string | null;
  estado: string | null;
  fecha_inicio_utc: Date | string | null;
  fecha_fin_utc: Date | string | null;
  direccion?: string | null;
  deal_id?: string | null;
  deals?: { deal_id: string; title: string | null } | null;
  deal_product?: { id?: string | null; name?: string | null; code?: string | null } | null;
};

type DealRecord = {
  deal_id: string;
  title: string | null;
  pipeline_id: string | null;
  sede_label: string | null;
  training_address: string | null;
  comercial: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  sesiones: SessionRecord[];
  organization?: { name: string | null } | null;
};

type TrainerContext = {
  trainer: TrainerRecord & { trainer_id: string };
};

function extractResource(path: string | null | undefined): string {
  if (!path) return '';
  const normalized = String(path);
  const match = normalized.match(/\/trainer-portal(?:\/([^/?#]+))?/);
  if (!match) return '';
  return (match[1] ?? '').trim().toLowerCase();
}

function mapSession(session: SessionRecord) {
  const id = typeof session?.id === 'string' ? session.id : '';
  if (!id.length) return null;

  return {
    id,
    title: typeof session?.nombre_cache === 'string' ? session.nombre_cache : null,
    estado: typeof session?.estado === 'string' ? session.estado : null,
    start: toMadridISOString(session?.fecha_inicio_utc ?? null),
    end: toMadridISOString(session?.fecha_fin_utc ?? null),
    address: typeof session?.direccion === 'string' ? session.direccion?.trim() || null : null,
    product:
      session?.deal_product && typeof session.deal_product === 'object'
        ? {
            id:
              typeof session.deal_product.id === 'string' && session.deal_product.id.trim().length
                ? session.deal_product.id.trim()
                : null,
            name:
              typeof session.deal_product.name === 'string' && session.deal_product.name.trim().length
                ? session.deal_product.name.trim()
                : null,
            code:
              typeof session.deal_product.code === 'string' && session.deal_product.code.trim().length
                ? session.deal_product.code.trim()
                : null,
          }
        : null,
    deal:
      session?.deals && typeof session.deals === 'object'
        ? {
            id: typeof session.deals.deal_id === 'string' ? session.deals.deal_id : null,
            title: typeof session.deals.title === 'string' ? session.deals.title : null,
          }
        : session?.deal_id && typeof session.deal_id === 'string'
          ? { id: session.deal_id, title: null }
          : null,
  } as const;
}

function mapDeal(deal: DealRecord) {
  const sessions = Array.isArray(deal?.sesiones)
    ? deal.sesiones
        .map((session) => mapSession(session))
        .filter((session): session is NonNullable<ReturnType<typeof mapSession>> => !!session)
    : [];

  const normalizeText = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text.length ? text : null;
  };

  return {
    dealId: normalizeText(deal?.deal_id) ?? '',
    title: normalizeText(deal?.title),
    pipeline: normalizeText(deal?.pipeline_id),
    sedeLabel: normalizeText(deal?.sede_label),
    trainingAddress: normalizeText(deal?.training_address),
    comercial: normalizeText(deal?.comercial),
    createdAt: toMadridISOString(deal?.created_at ?? null),
    updatedAt: toMadridISOString(deal?.updated_at ?? null),
    organizationName: normalizeText(deal?.organization?.name ?? null),
    sessions,
  };
}

async function resolveTrainer(prisma: ReturnType<typeof getPrisma>, userId: string): Promise<TrainerRecord | null> {
  return prisma.trainers.findFirst({ where: { user_id: userId } });
}

async function buildTrainerContext(
  prisma: ReturnType<typeof getPrisma>,
  userId: string,
): Promise<TrainerContext | { error: ReturnType<typeof errorResponse> }> {
  const trainer = await resolveTrainer(prisma, userId);
  if (!trainer) {
    return { error: errorResponse('NOT_FOUND', 'No se encontró el formador asociado al usuario', 404) };
  }

  return { trainer };
}

export const handler = createHttpHandler(async (request) => {
  const prisma = getPrisma();

  const auth = await requireAuth(request, prisma, { requireRoles: ['Formador'] });
  if ('error' in auth) {
    return auth.error;
  }

  const context = await buildTrainerContext(prisma, auth.user.id);
  if ('error' in context) {
    return context.error;
  }

  const resource = extractResource(request.path);

  if (resource === '' || resource === 'metrics') {
    const trainerId = context.trainer.trainer_id;
    const now = new Date();

    const [plannedCount, totalAssigned, upcomingCount, nextSessionRaw] = await Promise.all([
      prisma.sesiones.count({
        where: {
          estado: 'PLANIFICADA',
          sesion_trainers: { some: { trainer_id: trainerId } },
        },
      }),
      prisma.sesiones.count({ where: { sesion_trainers: { some: { trainer_id: trainerId } } } }),
      prisma.sesiones.count({
        where: {
          fecha_inicio_utc: { gte: now },
          sesion_trainers: { some: { trainer_id: trainerId } },
          estado: { not: 'CANCELADA' },
        },
      }),
      prisma.sesiones.findFirst({
        where: {
          fecha_inicio_utc: { not: null, gte: now },
          sesion_trainers: { some: { trainer_id: trainerId } },
          estado: { not: 'CANCELADA' },
        },
        orderBy: { fecha_inicio_utc: 'asc' },
        select: {
          id: true,
          nombre_cache: true,
          estado: true,
          fecha_inicio_utc: true,
          fecha_fin_utc: true,
          deal_id: true,
          deals: { select: { deal_id: true, title: true } },
        },
      }),
    ]);

    const metrics = {
      plannedSessions: plannedCount,
      totalAssignedSessions: totalAssigned,
      upcomingSessions: upcomingCount,
      nextSession: nextSessionRaw ? mapSession(nextSessionRaw) : null,
    };

    return successResponse({ metrics });
  }

  if (resource === 'profile') {
    return successResponse({ trainer: normalizeTrainer(context.trainer) });
  }

  if (resource === 'budgets') {
    const trainerId = context.trainer.trainer_id;

    const deals = await prisma.deals.findMany({
      where: {
        sesiones: { some: { sesion_trainers: { some: { trainer_id: trainerId } } } },
      },
      select: {
        deal_id: true,
        title: true,
        pipeline_id: true,
        sede_label: true,
        training_address: true,
        comercial: true,
        created_at: true,
        updated_at: true,
        organization: { select: { name: true } },
        sesiones: {
          where: { sesion_trainers: { some: { trainer_id: trainerId } } },
          select: {
            id: true,
            nombre_cache: true,
            estado: true,
            fecha_inicio_utc: true,
            fecha_fin_utc: true,
            direccion: true,
            deal_id: true,
            deal_product: { select: { id: true, name: true, code: true } },
            deals: { select: { deal_id: true, title: true } },
          },
          orderBy: { fecha_inicio_utc: 'asc' },
        },
      },
      orderBy: { updated_at: 'desc' },
    });

    return successResponse({ budgets: deals.map((deal) => mapDeal(deal as DealRecord)) });
  }

  return errorResponse('NOT_FOUND', 'Recurso no encontrado', 404);
});

