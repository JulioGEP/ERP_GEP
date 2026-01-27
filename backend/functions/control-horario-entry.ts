import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { nowInMadridISO, toMadridISOString } from './_shared/timezone';

type UpdatePayload = {
  id?: string;
  date?: string;
  checkInTime?: string;
  checkOutTime?: string | null;
};

function getTodayDateString(): string {
  return nowInMadridISO().slice(0, 10);
}

function addDays(dateString: string, days: number): string {
  const base = new Date(`${dateString}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function normalizeDateString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function normalizeTimeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{2}:\d{2}$/.test(trimmed)) {
    return null;
  }
  const [hours, minutes] = trimmed.split(':').map((part) => Number.parseInt(part, 10));
  if (hours > 23 || minutes > 59) return null;
  return trimmed;
}

function combineDateAndTime(dateString: string, timeString: string): Date {
  return new Date(`${dateString}T${timeString}:00`);
}

async function ensureControlHorarioAccess(userId: string, role: string, prisma: ReturnType<typeof getPrisma>) {
  if (role.trim().toLowerCase() !== 'formador') {
    return { ok: true };
  }

  const trainer = await prisma.trainers.findUnique({
    where: { user_id: userId },
    select: { contrato_fijo: true },
  });

  if (!trainer?.contrato_fijo) {
    return { ok: false };
  }

  return { ok: true };
}

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'POST' && request.method !== 'PUT') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma);
  if ('error' in auth) {
    return auth.error;
  }

  const access = await ensureControlHorarioAccess(auth.user.id, auth.user.role, prisma);
  if (!access.ok) {
    return errorResponse('FORBIDDEN', 'No tienes permisos para modificar el fichaje.', 403);
  }

  const payload = (request.body ?? {}) as UpdatePayload;
  const checkInTime = normalizeTimeString(payload.checkInTime);
  const checkOutTime = payload.checkOutTime === null ? null : normalizeTimeString(payload.checkOutTime);

  if (!checkInTime) {
    return errorResponse('INVALID_TIME', 'La hora de entrada es obligatoria.', 400);
  }

  const today = getTodayDateString();
  const yesterday = addDays(today, -1);

  if (request.method === 'POST') {
    const dateString = normalizeDateString(payload.date);
    if (!dateString) {
      return errorResponse('INVALID_DATE', 'La fecha indicada no es válida.', 400);
    }
    if (dateString !== yesterday) {
      return errorResponse('DATE_LOCKED', 'Solo se pueden añadir fichajes del día anterior.', 403);
    }

    const entry = await prisma.user_time_logs.create({
      data: {
        user_id: auth.user.id,
        log_date: new Date(`${dateString}T00:00:00Z`),
        check_in_utc: combineDateAndTime(dateString, checkInTime),
        check_out_utc: checkOutTime ? combineDateAndTime(dateString, checkOutTime) : null,
      },
    });

    return successResponse({
      entry: {
        id: entry.id,
        date: dateString,
        checkIn: toMadridISOString(entry.check_in_utc),
        checkOut: toMadridISOString(entry.check_out_utc),
      },
    });
  }

  const entryId = typeof payload.id === 'string' ? payload.id.trim() : '';
  if (!entryId) {
    return errorResponse('INVALID_ID', 'El fichaje indicado no es válido.', 400);
  }

  const existing = await prisma.user_time_logs.findFirst({
    where: { id: entryId, user_id: auth.user.id },
  });

  if (!existing) {
    return errorResponse('NOT_FOUND', 'No se encontró el fichaje indicado.', 404);
  }

  const entryDate = existing.log_date.toISOString().slice(0, 10);
  if (entryDate !== yesterday) {
    return errorResponse('DATE_LOCKED', 'Solo se pueden modificar fichajes del día anterior.', 403);
  }

  const updated = await prisma.user_time_logs.update({
    where: { id: existing.id },
    data: {
      check_in_utc: combineDateAndTime(entryDate, checkInTime),
      check_out_utc: checkOutTime ? combineDateAndTime(entryDate, checkOutTime) : null,
    },
  });

  return successResponse({
    entry: {
      id: updated.id,
      date: entryDate,
      checkIn: toMadridISOString(updated.check_in_utc),
      checkOut: toMadridISOString(updated.check_out_utc),
    },
  });
});
