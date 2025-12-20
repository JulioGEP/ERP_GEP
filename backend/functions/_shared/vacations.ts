// backend/functions/_shared/vacations.ts
import type { PrismaClient } from '@prisma/client';

export const VACATION_TYPES = new Set(['V', 'L', 'A', 'T', 'M', 'H', 'F', 'R', 'P', 'I', 'N', 'C']);

export type VacationCounts = Record<'V' | 'L' | 'A' | 'T' | 'M' | 'H' | 'F' | 'R' | 'P' | 'I' | 'N' | 'C', number>;

export const DEFAULT_VACATION_ALLOWANCE = 24;
export const DEFAULT_ANNIVERSARY_ALLOWANCE = 1;
export const DEFAULT_LOCAL_HOLIDAY_ALLOWANCE = 2;
export const DEFAULT_PREVIOUS_YEAR_ALLOWANCE = 0;

export function calculateAnniversaryAutoConsumption(
  startDate: Date | null | undefined,
  year: number,
  allowance: number,
  today: Date = new Date(),
): number {
  if (!startDate || allowance <= 0) return 0;

  const anniversaryDate = new Date(Date.UTC(year, startDate.getUTCMonth(), startDate.getUTCDate()));
  if (Number.isNaN(anniversaryDate.getTime())) return 0;

  const todayYear = today.getUTCFullYear();
  if (todayYear > year) return allowance;
  if (todayYear < year) return 0;

  const todayDateOnly = new Date(Date.UTC(todayYear, today.getUTCMonth(), today.getUTCDate()));
  return todayDateOnly >= anniversaryDate ? allowance : 0;
}

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
  anniversaryAllowance: number;
  localHolidayAllowance: number;
  previousYearAllowance: number;
  totalAllowance: number;
  enjoyed: number;
  remaining: number | null;
  counts: VacationCounts;
  days: Array<{ date: string; type: string }>;
}> {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));

  const [days, balance, user] = await Promise.all([
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
    prisma.users.findUnique({
      where: { id: userId },
      select: { start_date: true },
    }),
  ]);

  const counts: VacationCounts = { V: 0, L: 0, A: 0, T: 0, M: 0, H: 0, F: 0, R: 0, P: 0, I: 0, N: 0, C: 0 };
  for (const day of days) {
    const key = day.type as keyof VacationCounts;
    if (counts[key] !== undefined) {
      counts[key] += 1;
    }
  }

  const allowance = typeof balance?.allowance_days === 'number' ? balance.allowance_days : DEFAULT_VACATION_ALLOWANCE;
  const anniversaryAllowance =
    typeof balance?.anniversary_days === 'number' ? balance.anniversary_days : DEFAULT_ANNIVERSARY_ALLOWANCE;
  const localHolidayAllowance =
    typeof balance?.local_holiday_days === 'number' ? balance.local_holiday_days : DEFAULT_LOCAL_HOLIDAY_ALLOWANCE;
  const previousYearAllowance =
    typeof balance?.previous_year_days === 'number' ? balance.previous_year_days : DEFAULT_PREVIOUS_YEAR_ALLOWANCE;

  const anniversaryAutoConsumed = calculateAnniversaryAutoConsumption(
    user?.start_date ?? null,
    year,
    anniversaryAllowance,
  );
  const anniversaryEnjoyed = Math.max(counts.A, anniversaryAutoConsumed);
  const totalAllowance = allowance + anniversaryAllowance + previousYearAllowance;
  const remaining = totalAllowance - (counts.V + anniversaryEnjoyed);

  return {
    year,
    allowance,
    anniversaryAllowance,
    localHolidayAllowance,
    previousYearAllowance,
    totalAllowance,
    enjoyed: counts.V + anniversaryEnjoyed,
    remaining: remaining >= 0 ? remaining : 0,
    counts: { ...counts, A: anniversaryEnjoyed },
    days: days.map((day: typeof days[number]) => ({ date: formatDateOnly(day.date), type: day.type })),
  };
}
