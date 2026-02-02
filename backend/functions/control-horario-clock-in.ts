import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { nowInMadridISO, toMadridISOString } from './_shared/timezone';

function getTodayDateString(): string {
  return nowInMadridISO().slice(0, 10);
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
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma);
  if ('error' in auth) {
    return auth.error;
  }

  const access = await ensureControlHorarioAccess(auth.user.id, auth.user.role, prisma);
  if (!access.ok) {
    return errorResponse('FORBIDDEN', 'No tienes permisos para iniciar la jornada.', 403);
  }

  const openEntry = await prisma.user_time_logs.findFirst({
    where: {
      user_id: auth.user.id,
      check_out_utc: null,
    },
    orderBy: { check_in_utc: 'desc' },
  });

  if (openEntry) {
    const today = getTodayDateString();
    const openEntryDate = openEntry.log_date.toISOString().slice(0, 10);

    if (openEntryDate >= today) {
      return errorResponse('OPEN_ENTRY', 'Ya hay una jornada en curso.', 400);
    }

    await prisma.user_time_logs.update({
      where: { id: openEntry.id },
      data: {
        check_out_utc: new Date(`${openEntryDate}T23:59:59`),
      },
    });
  }

  const now = new Date();
  const logDate = getTodayDateString();

  const entry = await prisma.user_time_logs.create({
    data: {
      user_id: auth.user.id,
      log_date: new Date(`${logDate}T00:00:00Z`),
      check_in_utc: now,
    },
  });

  return successResponse({
    entry: {
      id: entry.id,
      date: logDate,
      checkIn: toMadridISOString(entry.check_in_utc),
      checkOut: toMadridISOString(entry.check_out_utc),
    },
  });
});
