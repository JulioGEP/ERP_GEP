// backend/functions/user-vacations.ts
import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import { requireAuth, normalizeRoleKey, type AuthenticatedContext } from './_shared/auth';

const VACATION_TYPES = new Set(['A', 'F', 'L', 'C', 'T']);

function parseDateOnly(value: unknown): Date | null {
  if (!value) return null;
  const input = typeof value === 'string' ? value.trim() : String(value);
  if (!input.length) return null;
  const normalized = input.includes('T') ? input.split('T')[0] : input;
  const result = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(result.getTime())) return null;
  return result;
}

function parseYear(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  if (normalized < 1970 || normalized > 9999) return fallback;
  return normalized;
}

function canManageUser(auth: AuthenticatedContext, userId: string): boolean {
  return normalizeRoleKey(auth.user.role) === 'admin' || auth.user.id === userId;
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function buildVacationPayload(
  prisma: ReturnType<typeof getPrisma>,
  userId: string,
  year: number,
) {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));

  const [days, balance] = await Promise.all([
    prisma.user_vacation_days.findMany({
      where: {
        user_id: userId,
        date: { gte: start, lt: end },
      },
      orderBy: { date: 'asc' },
    }),
    prisma.user_vacation_balances.findUnique({
      where: { user_id_year: { user_id: userId, year } },
    }),
  ]);

  const counts: Record<'A' | 'F' | 'L' | 'C' | 'T', number> = { A: 0, F: 0, L: 0, C: 0, T: 0 };
  for (const day of days) {
    const key = day.type as keyof typeof counts;
    if (counts[key] !== undefined) {
      counts[key] += 1;
    }
  }

  const enjoyed = counts.A + counts.F + counts.L + counts.C;
  const allowance = typeof balance?.allowance_days === 'number' ? balance.allowance_days : null;
  const remaining = allowance !== null ? allowance - enjoyed : null;

  return {
    year,
    allowance,
    enjoyed,
    remaining,
    counts,
    days: days.map((day) => ({ date: formatDateOnly(day.date), type: day.type })),
  };
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

  if (!userId || !Number.isFinite(allowance) || allowance < 0) {
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
    update: { allowance_days: Math.floor(allowance) },
    create: { user_id: userId, year, allowance_days: Math.floor(allowance) },
  });

  const payload = await buildVacationPayload(prisma, userId, year);
  return successResponse(payload);
}
