// backend/functions/_shared/vacations.ts
import type { PrismaClient } from '@prisma/client';

export const VACATION_TYPES = new Set(['A', 'F', 'L', 'C', 'T']);

export type VacationCounts = Record<'A' | 'F' | 'L' | 'C' | 'T', number>;

export function parseDateOnly(value: unknown): Date | null {
  if (!value) return null;
  const input = typeof value === 'string' ? value.trim() : String(value);
  if (!input.length) return null;
  const normalized = input.includes('T') ? input.split('T')[0] : input;
  const result = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(result.getTime())) return null;
  return result;
}

export function parseYear(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  if (normalized < 1970 || normalized > 9999) return fallback;
  return normalized;
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function buildVacationPayload(
  prisma: PrismaClient,
  userId: string,
  year: number,
): Promise<{
  year: number;
  allowance: number | null;
  enjoyed: number;
  remaining: number | null;
  counts: VacationCounts;
  days: Array<{ date: string; type: string }>;
}> {
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

  const counts: VacationCounts = { A: 0, F: 0, L: 0, C: 0, T: 0 };
  for (const day of days) {
    const key = day.type as keyof VacationCounts;
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
