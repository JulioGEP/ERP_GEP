// backend/functions/user-vacations-summary.ts
import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import { normalizeRoleKey, requireAuth } from './_shared/auth';
import {
  DEFAULT_ANNIVERSARY_ALLOWANCE,
  DEFAULT_LOCAL_HOLIDAY_ALLOWANCE,
  DEFAULT_PREVIOUS_YEAR_ALLOWANCE,
  DEFAULT_VACATION_ALLOWANCE,
  formatDateOnly,
  getEffectiveVacationDays,
  parseYear,
} from './_shared/vacations';

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

  const year = parseYear(request.query.year, new Date().getUTCFullYear());

  const users = await prisma.users.findMany({
    where: {
      active: true,
      OR: [
        { role: { not: 'Formador' } },
        { role: 'Formador', trainer: { is: { contrato_fijo: true } } },
      ],
    },
    select: { id: true, first_name: true, last_name: true, role: true, active: true },
    orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
  });

  if (users.length === 0) {
    return successResponse({ year, generatedAt: new Date().toISOString(), users: [] });
  }

  const userIds = users.map((user: (typeof users)[number]) => user.id);
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));

  const [days, balances] = await Promise.all([
    prisma.user_vacation_days.findMany({
      where: { user_id: { in: userIds }, date: { gte: start, lt: end } },
      orderBy: { date: 'asc' },
    }),
    prisma.user_vacation_balances.findMany({
      where: { user_id: { in: userIds }, year },
    }),
  ]);

  const balanceMap = new Map<string, (typeof balances)[number]>(
    balances.map((balance: (typeof balances)[number]) => [balance.user_id, balance]),
  );
  const daysByUser = new Map<string, typeof days>();

  for (const day of days) {
    const bucket = daysByUser.get(day.user_id) ?? [];
    bucket.push(day);
    daysByUser.set(day.user_id, bucket);
  }

  const todayIso = formatDateOnly(new Date());
  const userSummaries = users.map((user: (typeof users)[number]) => {
    const userDays = daysByUser.get(user.id) ?? [];
    const { effectiveVacationDays, counts } = getEffectiveVacationDays(userDays);
    const normalizedDays = userDays.map((day: (typeof userDays)[number]) => ({
      date: formatDateOnly(day.date),
      type: day.type,
    }));

    const balance = balanceMap.get(user.id);
    const allowance = balance?.allowance_days ?? DEFAULT_VACATION_ALLOWANCE;
    const anniversaryAllowance = balance?.anniversary_days ?? DEFAULT_ANNIVERSARY_ALLOWANCE;
    const localHolidayAllowance = balance?.local_holiday_days ?? DEFAULT_LOCAL_HOLIDAY_ALLOWANCE;
    const previousYearAllowance = balance?.previous_year_days ?? DEFAULT_PREVIOUS_YEAR_ALLOWANCE;

    const totalAllowance = allowance + anniversaryAllowance + previousYearAllowance;
    const enjoyed = effectiveVacationDays + counts.A + counts.Y;
    const remaining = totalAllowance - enjoyed;

    const upcomingDates = normalizedDays
      .filter((day: (typeof normalizedDays)[number]) => day.date >= todayIso)
      .slice(0, 5)
      .map((day: (typeof normalizedDays)[number]) => day.date);

    return {
      userId: user.id,
      fullName: `${user.first_name} ${user.last_name}`.trim(),
      role: user.role,
      active: user.active,
      allowance,
      anniversaryAllowance,
      localHolidayAllowance,
      previousYearAllowance,
      totalAllowance,
      enjoyed,
      remaining: remaining >= 0 ? remaining : 0,
      counts,
      upcomingDates,
      days: normalizedDays,
      lastUpdated: normalizedDays.at(-1)?.date ?? null,
    };
  });

  return successResponse({ year, generatedAt: new Date().toISOString(), users: userSummaries });
});
