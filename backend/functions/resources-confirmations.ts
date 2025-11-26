// backend/functions/resources-confirmations.ts
import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { requireAuth } from './_shared/auth';
import { errorResponse, successResponse } from './_shared/response';
import { nowInMadridISO, toMadridISOString } from './_shared/timezone';

const ALLOWED_ROLES = ['Admin', 'Administracion', 'Logistica', 'People'] as const;

const PIPELINE_LABELS_COMPANY = [
  'formacion empresa',
  'formacion empresas',
  'formación empresa',
  'formación empresas',
];

const PIPELINE_LABELS_GEP_SERVICES = ['gep services'];

type TrainerInviteStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED';
type SessionPipelineType = 'FORMACION_EMPRESA' | 'GEP_SERVICES';

type SessionInviteRecord = {
  id: string;
  trainer_id: string | null;
  token: string | null;
  status: string | null;
  sent_at: Date | string | null;
  responded_at: Date | string | null;
  trainer_email: string | null;
  sesiones: {
    id: string;
    nombre_cache: string | null;
    deal_id: string | null;
    deal_products: { name: string | null } | null;
    deals: {
      deal_id: string | null;
      pipeline_id: string | null;
      pipeline_label: string | null;
      title: string | null;
    } | null;
    fecha_inicio_utc: Date | string | null;
  } | null;
  trainers: {
    trainer_id: string | null;
    name: string | null;
    apellido: string | null;
    email: string | null;
  } | null;
};

type VariantInviteRecord = {
  id: string;
  trainer_id: string | null;
  status: string | null;
  sent_at: Date | string | null;
  responded_at: Date | string | null;
  trainer_email: string | null;
  variant: {
    id: string;
    name: string | null;
    sede: string | null;
    date: Date | string | null;
    products: { name: string | null } | null;
  } | null;
  trainers: {
    trainer_id: string | null;
    name: string | null;
    apellido: string | null;
    email: string | null;
  } | null;
};

type SessionConfirmationRow = {
  inviteId: string;
  sessionId: string;
  dealId: string | null;
  sessionTitle: string | null;
  productName: string | null;
  pipelineLabel: string | null;
  pipelineType: SessionPipelineType;
  trainerId: string | null;
  trainerName: string | null;
  trainerEmail: string | null;
  status: TrainerInviteStatus;
  startDate: string | null;
  sentAt: string | null;
  respondedAt: string | null;
};

type VariantConfirmationRow = {
  inviteId: string;
  variantId: string | null;
  variantName: string | null;
  productName: string | null;
  site: string | null;
  date: string | null;
  trainerId: string | null;
  trainerName: string | null;
  trainerEmail: string | null;
  status: TrainerInviteStatus;
  sentAt: string | null;
  respondedAt: string | null;
};

const STATUS_VALUES = new Set<TrainerInviteStatus>(['PENDING', 'CONFIRMED', 'DECLINED']);

function normalizePipeline(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return trimmed.length ? trimmed : null;
}

const NORMALIZED_COMPANY_PIPELINES = new Set(
  PIPELINE_LABELS_COMPANY.map((value) => normalizePipeline(value)).filter(
    (value): value is string => Boolean(value),
  ),
);

const NORMALIZED_GEP_PIPELINES = new Set(
  PIPELINE_LABELS_GEP_SERVICES.map((value) => normalizePipeline(value)).filter(
    (value): value is string => Boolean(value),
  ),
);

function resolveSessionPipelineType(session: SessionInviteRecord['sesiones']): SessionPipelineType | null {
  if (!session) return null;
  const source = session.deals?.pipeline_id ?? session.deals?.pipeline_label ?? null;
  const normalized = normalizePipeline(source);
  if (!normalized) return null;
  if (NORMALIZED_COMPANY_PIPELINES.has(normalized)) return 'FORMACION_EMPRESA';
  if (NORMALIZED_GEP_PIPELINES.has(normalized)) return 'GEP_SERVICES';
  return null;
}

function normalizeStatus(value: unknown): TrainerInviteStatus | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return STATUS_VALUES.has(upper as TrainerInviteStatus) ? (upper as TrainerInviteStatus) : null;
}

function formatFullName(trainer: SessionInviteRecord['trainers']): string | null {
  if (!trainer) return null;
  const parts = [trainer.name ?? '', trainer.apellido ?? '']
    .map((part) => part.trim())
    .filter((part) => part.length);
  if (parts.length === 0) return trainer.name ?? null;
  return parts.join(' ');
}

function buildSessionInvitePayload(invite: SessionInviteRecord): SessionConfirmationRow | null {
  if (!invite.sesiones) return null;
  const pipelineType = resolveSessionPipelineType(invite.sesiones);
  if (!pipelineType) return null;
  const status = normalizeStatus(invite.status);
  if (!status) return null;
  return {
    inviteId: invite.id,
    sessionId: invite.sesiones.id,
    dealId: invite.sesiones.deal_id ?? invite.sesiones.deals?.deal_id ?? null,
    sessionTitle: invite.sesiones.nombre_cache ?? invite.sesiones.deals?.title ?? null,
    productName: invite.sesiones.deal_products?.name ?? null,
    pipelineLabel:
      invite.sesiones.deals?.pipeline_label ?? invite.sesiones.deals?.pipeline_id ?? null,
    pipelineType,
    trainerId: invite.trainers?.trainer_id ?? invite.trainer_id ?? null,
    trainerName: formatFullName(invite.trainers),
    trainerEmail: invite.trainers?.email ?? invite.trainer_email ?? null,
    status,
    startDate: toMadridISOString(invite.sesiones.fecha_inicio_utc),
    sentAt: toMadridISOString(invite.sent_at),
    respondedAt: toMadridISOString(invite.responded_at),
  };
}

function buildVariantInvitePayload(invite: VariantInviteRecord): VariantConfirmationRow | null {
  if (!invite.variant) return null;
  const status = normalizeStatus(invite.status);
  if (!status) return null;
  const trainerName = (() => {
    if (!invite.trainers) return null;
    const parts = [invite.trainers.name ?? '', invite.trainers.apellido ?? '']
      .map((part) => part.trim())
      .filter((part) => part.length);
    if (parts.length === 0) return invite.trainers.name ?? null;
    return parts.join(' ');
  })();
  return {
    inviteId: invite.id,
    variantId: invite.variant.id,
    variantName: invite.variant.name ?? null,
    productName: invite.variant.products?.name ?? null,
    site: invite.variant.sede ?? null,
    date: toMadridISOString(invite.variant.date),
    trainerId: invite.trainers?.trainer_id ?? invite.trainer_id ?? null,
    trainerName,
    trainerEmail: invite.trainers?.email ?? invite.trainer_email ?? null,
    status,
    sentAt: toMadridISOString(invite.sent_at),
    respondedAt: toMadridISOString(invite.responded_at),
  };
}

function buildSessionInviteWhereClause() {
  const conditions: Array<Record<string, unknown>> = [];
  const values = [...PIPELINE_LABELS_COMPANY, ...PIPELINE_LABELS_GEP_SERVICES];
  for (const value of values) {
    conditions.push({
      sesiones: { deals: { pipeline_id: { equals: value, mode: 'insensitive' as const } } },
    });
    conditions.push({
      sesiones: { deals: { pipeline_label: { equals: value, mode: 'insensitive' as const } } },
    });
  }
  return conditions.length ? { OR: conditions } : undefined;
}

const SESSION_INVITE_WHERE = buildSessionInviteWhereClause();

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ALLOWED_ROLES });
  if ('error' in auth) {
    return auth.error;
  }

  const [sessionInvites, variantInvites] = await Promise.all([
    prisma.trainer_session_invites.findMany({
      where: SESSION_INVITE_WHERE,
      include: {
        sesiones: {
          select: {
            id: true,
            nombre_cache: true,
            deal_id: true,
            deal_products: { select: { name: true } },
            deals: {
              select: {
                deal_id: true,
                pipeline_id: true,
                pipeline_label: true,
                title: true,
              },
            },
            fecha_inicio_utc: true,
          },
        },
        trainers: { select: { trainer_id: true, name: true, apellido: true, email: true } },
      },
      orderBy: [{ sent_at: 'desc' }, { created_at: 'desc' }],
    }) as Promise<SessionInviteRecord[]>,
    prisma.variant_trainer_invites.findMany({
      include: {
        variant: { select: { id: true, name: true, sede: true, date: true, products: { select: { name: true } } } },
        trainers: { select: { trainer_id: true, name: true, apellido: true, email: true } },
      },
      orderBy: [{ sent_at: 'desc' }, { created_at: 'desc' }],
    }) as Promise<VariantInviteRecord[]>,
  ]);

  const sessionRows = sessionInvites
    .map((invite) => buildSessionInvitePayload(invite))
    .filter((row): row is SessionConfirmationRow => row !== null);
  const variantRows = variantInvites
    .map((invite) => buildVariantInvitePayload(invite))
    .filter((row): row is VariantConfirmationRow => row !== null);

  return successResponse({
    sessionInvites: sessionRows,
    variantInvites: variantRows,
    generatedAt: nowInMadridISO(),
  });
});
