// backend/functions/user-vacations-bulk.ts
import type { Prisma } from '@prisma/client';

import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import { normalizeRoleKey, requireAuth } from './_shared/auth';
import { VACATION_TYPES, buildVacationPayload, formatDateOnly, parseDateOnly } from './_shared/vacations';

export const handler = createHttpHandler<any>(async (request) => {
  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma);

  if ('error' in auth) {
    return auth.error;
  }

  const role = normalizeRoleKey(auth.user.role);
  if (role !== 'admin' && role !== 'people') {
    return errorResponse('FORBIDDEN', 'No tienes permisos para esta operación', 403);
  }

  if (!request.body || typeof request.body !== 'object') {
    return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
  }

  const dateInputs = Array.isArray(request.body.dates)
    ? request.body.dates
    : request.body.date
      ? [request.body.date]
      : [];
  const parsedDates = dateInputs
    .map((date) => parseDateOnly(date))
    .filter((date): date is Date => Boolean(date));

  const type = request.body.type ? String(request.body.type).trim().toUpperCase() : '';
  const userIds: string[] = Array.isArray(request.body.userIds)
    ? request.body.userIds.map((id: unknown) => String(id).trim()).filter(Boolean)
    : [];

  if (!parsedDates.length || !type || !VACATION_TYPES.has(type)) {
    return errorResponse('VALIDATION_ERROR', 'Fecha o tipo inválido', 400);
  }

  if (!userIds.length) {
    return errorResponse('VALIDATION_ERROR', 'Debes seleccionar al menos un usuario', 400);
  }

  const years = new Set(parsedDates.map((date) => date.getUTCFullYear()));
  if (years.size > 1) {
    return errorResponse('VALIDATION_ERROR', 'Todas las fechas deben ser del mismo año', 400);
  }

  const users = await prisma.users.findMany({ where: { id: { in: userIds }, active: true } });
  const validUserIds = users.map((user) => user.id);

  if (!validUserIds.length) {
    return errorResponse('VALIDATION_ERROR', 'Ninguno de los usuarios seleccionados está activo o es válido', 400);
  }

  const ignoredUserIds = userIds.filter((id) => !validUserIds.includes(id));

  const uniqueDates = Array.from(new Set(parsedDates.map((date) => formatDateOnly(date)))).sort();
  const year = parsedDates[0].getUTCFullYear();

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    for (const userId of validUserIds) {
      for (const date of parsedDates) {
        await tx.user_vacation_days.upsert({
          where: { user_id_date: { user_id: userId, date } },
          update: { type },
          create: { user_id: userId, date, type },
        });
      }
    }
  });

  const updated = await Promise.all(validUserIds.map((userId) => buildVacationPayload(prisma, userId, year)));
  const responsePayload = updated.map((summary, index) => ({ ...summary, userId: validUserIds[index] }));

  return successResponse({ dates: uniqueDates, updated: responsePayload, ignoredUserIds });
});
