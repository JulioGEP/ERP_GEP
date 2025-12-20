// backend/functions/user-vacations.ts
import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import { requireAuth, normalizeRoleKey, type AuthenticatedContext } from './_shared/auth';
import {
  DEFAULT_ANNIVERSARY_ALLOWANCE,
  DEFAULT_LOCAL_HOLIDAY_ALLOWANCE,
  DEFAULT_PREVIOUS_YEAR_ALLOWANCE,
  DEFAULT_VACATION_ALLOWANCE,
  VACATION_TYPES,
  buildVacationPayload,
  formatDateOnly,
  parseDateOnly,
  parseYear,
} from './_shared/vacations';

function canManageUser(auth: AuthenticatedContext, userId: string): boolean {
  return normalizeRoleKey(auth.user.role) === 'admin' || auth.user.id === userId;
}

export const handler = createHttpHandler<any>(async (request) => {
  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma);

  if ('error' in auth) {
    return auth.error;
  }

  switch (request.method) {
    case 'GET':
      return handleGet(request, prisma, auth);
    case 'POST':
      return handleUpsertDay(request, prisma, auth);
    case 'PATCH':
      return handleAllowance(request, prisma, auth);
    default:
      return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }
});

async function handleGet(
  request: any,
  prisma: ReturnType<typeof getPrisma>,
  auth: AuthenticatedContext,
) {
  const userId = String(request.query.userId || request.query.user_id || '').trim();
  const year = parseYear(request.query.year, new Date().getUTCFullYear());

  if (!userId) {
    return errorResponse('VALIDATION_ERROR', 'userId es obligatorio', 400);
  }

  if (!canManageUser(auth, userId)) {
    return errorResponse('FORBIDDEN', 'No tienes permisos para esta operación', 403);
  }

  const user = await prisma.users.findUnique({ where: { id: userId } });
  if (!user) {
    return errorResponse('NOT_FOUND', 'Usuario no encontrado', 404);
  }

  const payload = await buildVacationPayload(prisma, userId, year);
  return successResponse(payload);
}

async function handleUpsertDay(
  request: any,
  prisma: ReturnType<typeof getPrisma>,
  auth: AuthenticatedContext,
) {
  if (!request.body || typeof request.body !== 'object') {
    return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
  }

  const userId = String(request.body.userId || request.body.user_id || '').trim();
  const dateInput = parseDateOnly(request.body.date);
  const type = request.body.type ? String(request.body.type).trim().toUpperCase() : '';

  if (!userId || !dateInput) {
    return errorResponse('VALIDATION_ERROR', 'userId y date son obligatorios', 400);
  }

  if (!canManageUser(auth, userId)) {
    return errorResponse('FORBIDDEN', 'No tienes permisos para esta operación', 403);
  }

  if (type && !VACATION_TYPES.has(type)) {
    return errorResponse('VALIDATION_ERROR', 'Tipo de ausencia no válido', 400);
  }

  const user = await prisma.users.findUnique({ where: { id: userId } });
  if (!user) {
    return errorResponse('NOT_FOUND', 'Usuario no encontrado', 404);
  }

  const year = dateInput.getUTCFullYear();
  const dateOnly = formatDateOnly(dateInput);

  if (!type) {
    await prisma.user_vacation_days.deleteMany({ where: { user_id: userId, date: dateInput } });
  } else {
    await prisma.user_vacation_days.upsert({
      where: { user_id_date: { user_id: userId, date: dateInput } },
      update: { type },
      create: { user_id: userId, date: dateInput, type },
    });
  }

  const payload = await buildVacationPayload(prisma, userId, year);
  return successResponse({ ...payload, updatedDate: dateOnly });
}

async function handleAllowance(
  request: any,
  prisma: ReturnType<typeof getPrisma>,
  auth: AuthenticatedContext,
) {
  if (!request.body || typeof request.body !== 'object') {
    return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
  }

  const userId = String(request.body.userId || request.body.user_id || '').trim();
  const year = parseYear(request.body.year, new Date().getUTCFullYear());
  const allowance = Number(request.body.allowance ?? request.body.allowance_days);
  const anniversaryAllowance = Number(request.body.anniversaryAllowance ?? request.body.anniversary_days);
  const localHolidayAllowance = Number(request.body.localHolidayAllowance ?? request.body.local_holiday_days);
  const previousYearAllowance = Number(request.body.previousYearAllowance ?? request.body.previous_year_days);

  if (
    !userId ||
    !Number.isFinite(allowance) ||
    allowance < 0 ||
    !Number.isFinite(anniversaryAllowance) ||
    anniversaryAllowance < 0 ||
    !Number.isFinite(localHolidayAllowance) ||
    localHolidayAllowance < 0 ||
    !Number.isFinite(previousYearAllowance) ||
    previousYearAllowance < 0
  ) {
    return errorResponse('VALIDATION_ERROR', 'Datos inválidos', 400);
  }

  if (!canManageUser(auth, userId)) {
    return errorResponse('FORBIDDEN', 'No tienes permisos para esta operación', 403);
  }

  const user = await prisma.users.findUnique({ where: { id: userId } });
  if (!user) {
    return errorResponse('NOT_FOUND', 'Usuario no encontrado', 404);
  }

  await prisma.user_vacation_balances.upsert({
    where: { user_id_year: { user_id: userId, year } },
    update: {
      allowance_days: Math.floor(allowance),
      anniversary_days: Math.floor(anniversaryAllowance ?? DEFAULT_ANNIVERSARY_ALLOWANCE),
      local_holiday_days: Math.floor(localHolidayAllowance ?? DEFAULT_LOCAL_HOLIDAY_ALLOWANCE),
      previous_year_days: Math.floor(previousYearAllowance ?? DEFAULT_PREVIOUS_YEAR_ALLOWANCE),
    },
    create: {
      user_id: userId,
      year,
      allowance_days: Math.floor(allowance ?? DEFAULT_VACATION_ALLOWANCE),
      anniversary_days: Math.floor(anniversaryAllowance ?? DEFAULT_ANNIVERSARY_ALLOWANCE),
      local_holiday_days: Math.floor(localHolidayAllowance ?? DEFAULT_LOCAL_HOLIDAY_ALLOWANCE),
      previous_year_days: Math.floor(previousYearAllowance ?? DEFAULT_PREVIOUS_YEAR_ALLOWANCE),
    },
  });

  const payload = await buildVacationPayload(prisma, userId, year, { skipCarryoverUpdate: true });
  return successResponse(payload);
}
