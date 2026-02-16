import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { nowInMadridISO, toMadridISOString } from './_shared/timezone';

type ControlHorarioEntryPayload = {
  id?: string;
  userId?: string;
  date?: string;
  checkInTime?: string;
  checkOutTime?: string | null;
};

type HolidayType = 'A' | 'N';

function getTodayDateString(): string {
  return nowInMadridISO().slice(0, 10);
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

function buildDateRange(startDate: string | null, endDate: string | null): { start: string; end: string } {
  const today = getTodayDateString();
  const resolvedEnd = endDate ?? today;
  if (startDate) {
    return { start: startDate, end: resolvedEnd };
  }
  const [year, month] = resolvedEnd.split('-').map((value) => Number.parseInt(value, 10));
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
  return { start: firstDay, end: resolvedEnd };
}

export const handler = createHttpHandler(async (request) => {
  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ['Admin'] });
  if ('error' in auth) {
    return auth.error;
  }

  if (request.method === 'GET') {
    const startDate = normalizeDateString(request.query.startDate);
    const endDate = normalizeDateString(request.query.endDate);
    const range = buildDateRange(startDate, endDate);
    if (range.start > range.end) {
      return errorResponse('INVALID_RANGE', 'La fecha de inicio no puede ser posterior a la fecha de fin.', 400);
    }

    const people = await prisma.users.findMany({
      where: {
        active: true,
        OR: [
          { role: { not: 'Formador' } },
          { role: 'Formador', trainer: { is: { contrato_fijo: true } } },
        ],
      },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
        role: true,
        trainer: { select: { contrato_fijo: true } },
      },
      orderBy: [{ last_name: 'asc' }, { first_name: 'asc' }],
    });

    const userIds = people.map((person) => person.id);
    const logs = await prisma.user_time_logs.findMany({
      where: {
        user_id: { in: userIds },
        log_date: {
          gte: new Date(`${range.start}T00:00:00Z`),
          lte: new Date(`${range.end}T00:00:00Z`),
        },
      },
      orderBy: [{ log_date: 'asc' }, { check_in_utc: 'asc' }],
    });

    const holidayDays = await prisma.user_vacation_days.findMany({
      where: {
        user_id: { in: userIds },
        type: { in: ['A', 'N'] },
        date: {
          gte: new Date(`${range.start}T00:00:00Z`),
          lte: new Date(`${range.end}T00:00:00Z`),
        },
      },
      select: {
        user_id: true,
        date: true,
        type: true,
      },
    });

    const holidayMap = new Map<string, HolidayType>();
    holidayDays.forEach((holiday) => {
      const holidayDate = holiday.date.toISOString().slice(0, 10);
      holidayMap.set(`${holiday.user_id}-${holidayDate}`, holiday.type === 'N' ? 'N' : 'A');
    });

    return successResponse({
      range,
      people: people.map((person) => ({
        id: person.id,
        name: `${person.first_name} ${person.last_name}`.trim() || person.email,
        email: person.email,
        role: person.role,
        isFixedTrainer: person.trainer?.contrato_fijo === true,
      })),
      entries: logs.map((log) => ({
        id: log.id,
        userId: log.user_id,
        date: log.log_date.toISOString().slice(0, 10),
        checkIn: toMadridISOString(log.check_in_utc),
        checkOut: toMadridISOString(log.check_out_utc),
        holidayType: holidayMap.get(`${log.user_id}-${log.log_date.toISOString().slice(0, 10)}`) ?? null,
      })),
    });
  }

  if (request.method !== 'POST' && request.method !== 'PUT' && request.method !== 'DELETE') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const payload = (request.body ?? {}) as ControlHorarioEntryPayload;

  if (request.method === 'DELETE') {
    const entryId = typeof payload.id === 'string' ? payload.id.trim() : '';
    if (!entryId) {
      return errorResponse('INVALID_ID', 'El fichaje indicado no es válido.', 400);
    }

    const existing = await prisma.user_time_logs.findUnique({ where: { id: entryId } });
    if (!existing) {
      return errorResponse('NOT_FOUND', 'No se encontró el fichaje indicado.', 404);
    }

    await prisma.user_time_logs.delete({ where: { id: entryId } });
    return successResponse({ deleted: true, id: entryId });
  }

  const checkInTime = normalizeTimeString(payload.checkInTime);
  const checkOutTime = payload.checkOutTime === null ? null : normalizeTimeString(payload.checkOutTime);

  if (!checkInTime) {
    return errorResponse('INVALID_TIME', 'La hora de entrada es obligatoria.', 400);
  }

  if (request.method === 'POST') {
    const userId = typeof payload.userId === 'string' ? payload.userId.trim() : '';
    const dateString = normalizeDateString(payload.date);

    if (!userId || !dateString) {
      return errorResponse('INVALID_PAYLOAD', 'Datos incompletos para añadir el fichaje.', 400);
    }

    const entry = await prisma.user_time_logs.create({
      data: {
        user_id: userId,
        log_date: new Date(`${dateString}T00:00:00Z`),
        check_in_utc: combineDateAndTime(dateString, checkInTime),
        check_out_utc: checkOutTime ? combineDateAndTime(dateString, checkOutTime) : null,
      },
    });

    return successResponse({
      entry: {
        id: entry.id,
        userId,
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

  const existing = await prisma.user_time_logs.findUnique({ where: { id: entryId } });
  if (!existing) {
    return errorResponse('NOT_FOUND', 'No se encontró el fichaje indicado.', 404);
  }

  const entryDate = existing.log_date.toISOString().slice(0, 10);
  const updated = await prisma.user_time_logs.update({
    where: { id: entryId },
    data: {
      check_in_utc: combineDateAndTime(entryDate, checkInTime),
      check_out_utc: checkOutTime ? combineDateAndTime(entryDate, checkOutTime) : null,
    },
  });

  return successResponse({
    entry: {
      id: updated.id,
      userId: updated.user_id,
      date: entryDate,
      checkIn: toMadridISOString(updated.check_in_utc),
      checkOut: toMadridISOString(updated.check_out_utc),
    },
  });
});
