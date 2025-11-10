// backend/functions/trainer-session-time-logs.ts
import { validate as isUUID } from 'uuid';
import { createHttpHandler } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { nowInMadridDate, toMadridISOString } from './_shared/timezone';

function isMissingRelationError(error: unknown, relation: string): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message || '';
  const pattern = new RegExp(`\\b${relation}\\b`, 'i');
  return pattern.test(message);
}

type TrainerRecord = {
  trainer_id: string;
  name: string | null;
  apellido: string | null;
};

type AuthUser = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
};

type TimeLogRecord = {
  id: string;
  trainer_id: string;
  session_id: string | null;
  variant_id: string | null;
  scheduled_start_utc: Date | null;
  scheduled_end_utc: Date | null;
  check_in_utc: Date | null;
  check_out_utc: Date | null;
  recorded_by_user_id: string | null;
  recorded_by_name: string | null;
  source: string | null;
  created_at: Date;
  updated_at: Date;
};

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function buildRecordedByName(trainer: TrainerRecord, user: AuthUser): string {
  const userName = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
  if (userName.length) {
    return userName;
  }
  const trainerName = `${trainer.name ?? ''} ${trainer.apellido ?? ''}`.trim();
  if (trainerName.length) {
    return trainerName;
  }
  return user.email?.trim().length ? user.email.trim() : user.id;
}

function mapTimeLog(record: TimeLogRecord) {
  return {
    id: record.id,
    trainerId: record.trainer_id,
    sessionId: record.session_id,
    variantId: record.variant_id,
    scheduledStart: toMadridISOString(record.scheduled_start_utc),
    scheduledEnd: toMadridISOString(record.scheduled_end_utc),
    checkIn: toMadridISOString(record.check_in_utc),
    checkOut: toMadridISOString(record.check_out_utc),
    recordedByUserId: record.recorded_by_user_id,
    recordedByName: record.recorded_by_name,
    source: record.source ?? null,
    createdAt: toMadridISOString(record.created_at),
    updatedAt: toMadridISOString(record.updated_at),
  };
}

async function ensureTrainerAssignedToVariant(
  prisma: ReturnType<typeof getPrisma>,
  trainerId: string,
  variantId: string,
): Promise<boolean> {
  const variant = await prisma.variants.findUnique({
    where: { id: variantId },
    select: { trainer_id: true },
  });
  if (!variant) {
    return false;
  }
  if (variant.trainer_id === trainerId) {
    return true;
  }
  try {
    const rows = (await prisma.$queryRaw<{ trainer_id: string }[]>`
      SELECT trainer_id::text AS trainer_id
      FROM variant_trainer_links
      WHERE variant_id = ${variantId}::uuid
        AND trainer_id = ${trainerId}
      LIMIT 1
    `) as Array<{ trainer_id: string }>;
    return rows.some((row) => row.trainer_id === trainerId);
  } catch (error) {
    if (isMissingRelationError(error, 'variant_trainer_links')) {
      return false;
    }
    throw error;
  }
}

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET' && request.method !== 'PUT') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ['Formador'] });
  if ('error' in auth) {
    return auth.error;
  }

  const trainer = await prisma.trainers.findUnique({
    where: { user_id: auth.user.id },
    select: { trainer_id: true, name: true, apellido: true },
  });

  if (!trainer) {
    return errorResponse('NOT_FOUND', 'No se encontró un formador asociado al usuario.', 404);
  }

  const sessionIdRaw = request.query.sessionId?.trim() ?? '';
  const variantIdRaw = request.query.variantId?.trim() ?? '';

  const hasSession = sessionIdRaw.length > 0;
  const hasVariant = variantIdRaw.length > 0;

  if ((hasSession ? 1 : 0) + (hasVariant ? 1 : 0) !== 1) {
    return errorResponse('VALIDATION_ERROR', 'Debes proporcionar sessionId o variantId.', 400);
  }

  let sessionId: string | null = null;
  let variantId: string | null = null;

  if (hasSession) {
    if (!isUUID(sessionIdRaw)) {
      return errorResponse('VALIDATION_ERROR', 'sessionId no es un UUID válido.', 400);
    }
    sessionId = sessionIdRaw;
    const assignment = await prisma.sesion_trainers.findFirst({
      where: { sesion_id: sessionId, trainer_id: trainer.trainer_id },
      select: { trainer_id: true },
    });
    if (!assignment) {
      return errorResponse('FORBIDDEN', 'No tienes acceso a esta sesión.', 403);
    }
  } else if (hasVariant) {
    if (!isUUID(variantIdRaw)) {
      return errorResponse('VALIDATION_ERROR', 'variantId no es un UUID válido.', 400);
    }
    variantId = variantIdRaw;
    const assigned = await ensureTrainerAssignedToVariant(prisma, trainer.trainer_id, variantId);
    if (!assigned) {
      return errorResponse('FORBIDDEN', 'No tienes acceso a esta variante.', 403);
    }
  }

  if (request.method === 'GET') {
    const record = sessionId
      ? await prisma.trainer_session_time_logs.findUnique({
          where: { trainer_id_session_id: { trainer_id: trainer.trainer_id, session_id: sessionId } },
        })
      : await prisma.trainer_session_time_logs.findUnique({
          where: {
            trainer_id_variant_id: { trainer_id: trainer.trainer_id, variant_id: variantId! },
          },
        });

    return successResponse({ timeLog: record ? mapTimeLog(record as TimeLogRecord) : null });
  }

  const body = request.body;
  if (!body || typeof body !== 'object') {
    return errorResponse('VALIDATION_ERROR', 'Cuerpo JSON requerido.', 400);
  }

  const payload = body as Record<string, unknown>;
  const checkIn = parseDate(payload.checkIn);
  const checkOut = parseDate(payload.checkOut);
  const scheduledStart =
    parseDate(payload.scheduledStart) ??
    parseDate((payload as { plannedStart?: unknown }).plannedStart);
  const scheduledEnd =
    parseDate(payload.scheduledEnd) ??
    parseDate((payload as { plannedEnd?: unknown }).plannedEnd);

  if (!checkIn) {
    return errorResponse('VALIDATION_ERROR', 'Debes indicar una hora de entrada válida.', 400);
  }
  if (!checkOut) {
    return errorResponse('VALIDATION_ERROR', 'Debes indicar una hora de salida válida.', 400);
  }
  if (checkOut.getTime() <= checkIn.getTime()) {
    return errorResponse(
      'INVALID_RANGE',
      'La hora de salida debe ser posterior a la hora de entrada.',
      400,
    );
  }

  const now = nowInMadridDate();
  const baseData = {
    trainer_id: trainer.trainer_id,
    session_id: sessionId,
    variant_id: variantId,
    scheduled_start_utc: scheduledStart,
    scheduled_end_utc: scheduledEnd,
    check_in_utc: checkIn,
    check_out_utc: checkOut,
    recorded_by_user_id: auth.user.id,
    recorded_by_name: buildRecordedByName(trainer, auth.user as AuthUser),
    source: 'trainer_portal',
    updated_at: now,
  } satisfies Partial<TimeLogRecord> & { trainer_id: string };

  const createData = {
    ...baseData,
    created_at: now,
  };

  const saved = sessionId
    ? await prisma.trainer_session_time_logs.upsert({
        where: { trainer_id_session_id: { trainer_id: trainer.trainer_id, session_id: sessionId } },
        update: baseData,
        create: { ...createData, session_id: sessionId },
      })
    : await prisma.trainer_session_time_logs.upsert({
        where: {
          trainer_id_variant_id: { trainer_id: trainer.trainer_id, variant_id: variantId! },
        },
        update: baseData,
        create: { ...createData, variant_id: variantId },
      });

  return successResponse({ timeLog: mapTimeLog(saved as TimeLogRecord) });
});
