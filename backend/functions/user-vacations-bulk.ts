// backend/functions/user-vacations-bulk.ts
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

  const dateInput = parseDateOnly(request.body.date);
  const type = request.body.type ? String(request.body.type).trim().toUpperCase() : '';
  const userIds: string[] = Array.isArray(request.body.userIds)
    ? request.body.userIds.map((id: unknown) => String(id).trim()).filter(Boolean)
    : [];

  if (!dateInput || !type || !VACATION_TYPES.has(type)) {
    return errorResponse('VALIDATION_ERROR', 'Fecha o tipo inválido', 400);
  }

  if (!userIds.length) {
    return errorResponse('VALIDATION_ERROR', 'Debes seleccionar al menos un usuario', 400);
  }

  const users = await prisma.users.findMany({ where: { id: { in: userIds }, role: { not: 'Formador' }, active: true } });
  if (users.length !== userIds.length) {
    return errorResponse('NOT_FOUND', 'Algún usuario seleccionado no es válido', 404);
  }

  const dateOnly = formatDateOnly(dateInput);
  const year = dateInput.getUTCFullYear();

  await prisma.$transaction(async (tx) => {
    for (const userId of userIds) {
      await tx.user_vacation_days.upsert({
        where: { user_id_date: { user_id: userId, date: dateInput } },
        update: { type },
        create: { user_id: userId, date: dateInput, type },
      });
    }
  });

  const updated = await Promise.all(userIds.map((userId) => buildVacationPayload(prisma, userId, year)));
  const responsePayload = updated.map((summary, index) => ({ ...summary, userId: userIds[index] }));

  return successResponse({ date: dateOnly, updated: responsePayload });
});
