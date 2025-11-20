// backend/functions/user-vacations-summary.ts
import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import { normalizeRoleKey, requireAuth } from './_shared/auth';
import { formatDateOnly, parseYear } from './_shared/vacations';

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
    where: { role: { not: 'Formador' }, active: true },
    select: { id: true, first_name: true, last_name: true, role: true, active: true },
    orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
  });

  if (users.length === 0) {
    return successResponse({ year, generatedAt: new Date().toISOString(), users: [] });
  }

  const userIds = users.map((user) => user.id);
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

  const balanceMap = new Map(balances.map((balance) => [balance.user_id, balance]));
  const daysByUser = new Map<string, typeof days>();

  for (const day of days) {
    const bucket = daysByUser.get(day.user_id) ?? [];
    bucket.push(day);
    daysByUser.set(day.user_id, bucket);
  }

  const todayIso = formatDateOnly(new Date());
  const userSummaries = users.map((user) => {
    const userDays = daysByUser.get(user.id) ?? [];
    const counts: Record<'A' | 'F' | 'L' | 'C' | 'T', number> = { A: 0, F: 0, L: 0, C: 0, T: 0 };

    const normalizedDays = userDays.map((day) => {
      const key = day.type as keyof typeof counts;
      if (counts[key] !== undefined) counts[key] += 1;
      return { date: formatDateOnly(day.date), type: day.type };
    });

    const enjoyed = counts.A + counts.F + counts.L + counts.C;
    const allowance = balanceMap.get(user.id)?.allowance_days ?? null;
    const remaining = allowance !== null ? allowance - enjoyed : null;

    const upcomingDates = normalizedDays
      .filter((day) => day.date >= todayIso)
      .slice(0, 5)
      .map((day) => day.date);

    return {
      userId: user.id,
      fullName: `${user.first_name} ${user.last_name}`.trim(),
      role: user.role,
      active: user.active,
      allowance,
      enjoyed,
      remaining,
      counts,
      upcomingDates,
      days: normalizedDays,
      lastUpdated: normalizedDays.at(-1)?.date ?? null,
    };
  });

  return successResponse({ year, generatedAt: new Date().toISOString(), users: userSummaries });
});
