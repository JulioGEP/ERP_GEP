import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { nowInMadridISO, toMadridISOString } from './_shared/timezone';

function getTodayDateString(): string {
  return nowInMadridISO().slice(0, 10);
}

function addDays(dateString: string, days: number): string {
  const base = new Date(`${dateString}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function normalizeDateString(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
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

function resolveUserName(user: { first_name: string; last_name: string; email: string }): string {
  const parts = [user.first_name, user.last_name].map((value) => value.trim()).filter(Boolean);
  if (parts.length) return parts.join(' ');
  return user.email;
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
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma);
  if ('error' in auth) {
    return auth.error;
  }

  const access = await ensureControlHorarioAccess(auth.user.id, auth.user.role, prisma);
  if (!access.ok) {
    return errorResponse('FORBIDDEN', 'No tienes permisos para consultar el control horario.', 403);
  }

  const startDate = normalizeDateString(request.query.startDate);
  const endDate = normalizeDateString(request.query.endDate);
  const range = buildDateRange(startDate, endDate);
  if (range.start > range.end) {
    return errorResponse('INVALID_RANGE', 'La fecha de inicio no puede ser posterior a la fecha de fin.', 400);
  }

  const logs = await prisma.user_time_logs.findMany({
    where: {
      user_id: auth.user.id,
      log_date: {
        gte: new Date(`${range.start}T00:00:00Z`),
        lte: new Date(`${range.end}T00:00:00Z`),
      },
    },
    orderBy: [{ log_date: 'asc' }, { check_in_utc: 'asc' }],
  });

  const entries = logs.map((log) => ({
    id: log.id,
    date: log.log_date.toISOString().slice(0, 10),
    checkIn: toMadridISOString(log.check_in_utc),
    checkOut: toMadridISOString(log.check_out_utc),
  }));

  return successResponse({
    user: {
      id: auth.user.id,
      name: resolveUserName(auth.user),
      role: auth.user.role,
    },
    range,
    entries,
    meta: {
      yesterday: addDays(getTodayDateString(), -1),
    },
  });
});
