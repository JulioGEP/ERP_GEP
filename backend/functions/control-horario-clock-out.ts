import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { toMadridISOString } from './_shared/timezone';

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
    return errorResponse('FORBIDDEN', 'No tienes permisos para finalizar la jornada.', 403);
  }

  const openEntry = await prisma.user_time_logs.findFirst({
    where: {
      user_id: auth.user.id,
      check_out_utc: null,
    },
    orderBy: { check_in_utc: 'desc' },
  });

  if (!openEntry) {
    return errorResponse('NO_OPEN_ENTRY', 'No hay ninguna jornada en curso.', 400);
  }

  const entry = await prisma.user_time_logs.update({
    where: { id: openEntry.id },
    data: {
      check_out_utc: new Date(),
    },
  });

  return successResponse({
    entry: {
      id: entry.id,
      date: entry.log_date.toISOString().slice(0, 10),
      checkIn: toMadridISOString(entry.check_in_utc),
      checkOut: toMadridISOString(entry.check_out_utc),
    },
  });
});
