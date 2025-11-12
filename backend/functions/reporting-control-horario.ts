import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { toMadridISOString } from './_shared/timezone';

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

type TrainerInfo = {
  trainer_id: string;
  name: string | null;
  apellido: string | null;
};

type SessionInfo = {
  nombre_cache: string | null;
  fecha_inicio_utc: Date | null;
  fecha_fin_utc: Date | null;
  deals: {
    organizations: {
      name: string | null;
    } | null;
  } | null;
};

type VariantInfo = {
  name: string | null;
  sede: string | null;
  date: Date | null;
  products: {
    name: string | null;
  } | null;
};

type TimeLogWithRelations = {
  id: string;
  trainer_id: string;
  scheduled_start_utc: Date | null;
  scheduled_end_utc: Date | null;
  check_in_utc: Date | null;
  check_out_utc: Date | null;
  created_at: Date;
  updated_at: Date;
  trainer: TrainerInfo | null;
  sesion: SessionInfo | null;
  variant: VariantInfo | null;
};

function buildTrainerFullName(trainer: TrainerInfo | null, fallbackId: string): string {
  if (!trainer) {
    return fallbackId;
  }
  const parts = [trainer.name, trainer.apellido]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length);
  if (parts.length > 0) {
    return parts.join(' ');
  }
  return fallbackId;
}

function resolveSessionName(record: TimeLogWithRelations): string | null {
  const sessionName = normalizeText(record.sesion?.nombre_cache);
  if (sessionName) {
    return sessionName;
  }
  const variantName = normalizeText(record.variant?.name);
  if (variantName) {
    return variantName;
  }
  return normalizeText(record.variant?.products?.name);
}

function resolveOrganizationName(record: TimeLogWithRelations): string | null {
  const organization = normalizeText(record.sesion?.deals?.organizations?.name);
  if (organization) {
    return organization;
  }
  return normalizeText(record.variant?.sede);
}

function resolvePlannedStart(record: TimeLogWithRelations): Date | null {
  if (record.scheduled_start_utc) {
    return record.scheduled_start_utc;
  }
  if (record.sesion?.fecha_inicio_utc) {
    return record.sesion.fecha_inicio_utc;
  }
  if (record.variant?.date instanceof Date) {
    return record.variant.date;
  }
  return null;
}

function resolvePlannedEnd(record: TimeLogWithRelations): Date | null {
  if (record.scheduled_end_utc) {
    return record.scheduled_end_utc;
  }
  if (record.sesion?.fecha_fin_utc) {
    return record.sesion.fecha_fin_utc;
  }
  return null;
}

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ['Admin'] });
  if ('error' in auth) {
    return auth.error;
  }

  const logs = (await prisma.trainer_session_time_logs.findMany({
    orderBy: { check_in_utc: 'desc' },
    include: {
      trainer: {
        select: { trainer_id: true, name: true, apellido: true },
      },
      sesion: {
        select: {
          nombre_cache: true,
          fecha_inicio_utc: true,
          fecha_fin_utc: true,
          deals: {
            select: {
              organizations: {
                select: { name: true },
              },
            },
          },
        },
      },
      variant: {
        select: {
          name: true,
          sede: true,
          date: true,
          products: {
            select: { name: true },
          },
        },
      },
    },
  })) as TimeLogWithRelations[];

  const records = logs.map((log) => ({
    id: log.id,
    sessionName: resolveSessionName(log),
    organizationName: resolveOrganizationName(log),
    trainerFullName: buildTrainerFullName(log.trainer, log.trainer_id),
    plannedStart: toMadridISOString(resolvePlannedStart(log)),
    plannedEnd: toMadridISOString(resolvePlannedEnd(log)),
    clockIn: toMadridISOString(log.check_in_utc),
    clockOut: toMadridISOString(log.check_out_utc),
    createdAt: toMadridISOString(log.created_at),
    updatedAt: toMadridISOString(log.updated_at),
    isVariant: Boolean(log.variant) && !log.sesion,
  }));

  return successResponse({ records });
});
