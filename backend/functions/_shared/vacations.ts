// backend/functions/_shared/vacations.ts
import type { PrismaClient } from '@prisma/client';

export const VACATION_TYPES = new Set(['V', 'L', 'A', 'T', 'M', 'H', 'F', 'R', 'P', 'I', 'N', 'C', 'Y']);

export type VacationCounts = Record<'V' | 'L' | 'A' | 'T' | 'M' | 'H' | 'F' | 'R' | 'P' | 'I' | 'N' | 'C' | 'Y', number>;

export const DEFAULT_VACATION_ALLOWANCE = 24;
export const DEFAULT_ANNIVERSARY_ALLOWANCE = 1;
export const DEFAULT_LOCAL_HOLIDAY_ALLOWANCE = 2;
export const DEFAULT_PREVIOUS_YEAR_ALLOWANCE = 0;

type VacationYearData = {
  days: Array<{ date: Date; type: string }>;
  counts: VacationCounts;
  allowance: number;
  anniversaryAllowance: number;
  localHolidayAllowance: number;
  previousYearAllowance: number;
  totalAllowance: number;
  enjoyed: number;
  remaining: number;
  balance: Awaited<ReturnType<PrismaClient['user_vacation_balances']['findUnique']>>;
};

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

async function computeVacationYearData(
  prisma: PrismaClient,
  userId: string,
  year: number,
): Promise<VacationYearData> {
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

  const counts: VacationCounts = { V: 0, L: 0, A: 0, T: 0, M: 0, H: 0, F: 0, R: 0, P: 0, I: 0, N: 0, C: 0, Y: 0 };
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

  const totalAllowance = allowance + anniversaryAllowance + previousYearAllowance;
  const enjoyed = counts.V + counts.A + counts.Y;
  const remaining = totalAllowance - enjoyed;

  return {
    days,
    counts,
    allowance,
    anniversaryAllowance,
    localHolidayAllowance,
    previousYearAllowance,
    totalAllowance,
    enjoyed,
    remaining: remaining >= 0 ? remaining : 0,
    balance,
  };
}

// The carryover rules start applying after 2025. That year is considered the base
// year, so it should never accumulate vacation days from 2024.
const VACATION_CARRYOVER_BASE_YEAR = 2025;

export async function ensurePreviousYearCarryover(prisma: PrismaClient, userId: string, year: number) {
  const startOfYear = Date.UTC(year, 0, 1);
  if (Date.now() < startOfYear || year <= 1970) return null;

  const carryoverDays =
    year <= VACATION_CARRYOVER_BASE_YEAR
      ? 0
      : Math.max(Math.floor((await computeVacationYearData(prisma, userId, year - 1)).remaining), 0);

  const currentBalance = await prisma.user_vacation_balances.findUnique({
    where: { user_id_year: { user_id: userId, year } },
  });

  if (!currentBalance && carryoverDays === 0) return null;
  if (currentBalance && currentBalance.previous_year_days === carryoverDays) return currentBalance;

  return prisma.user_vacation_balances.upsert({
    where: { user_id_year: { user_id: userId, year } },
    update: { previous_year_days: carryoverDays },
    create: {
      user_id: userId,
      year,
      allowance_days: DEFAULT_VACATION_ALLOWANCE,
      anniversary_days: DEFAULT_ANNIVERSARY_ALLOWANCE,
      local_holiday_days: DEFAULT_LOCAL_HOLIDAY_ALLOWANCE,
      previous_year_days: carryoverDays,
    },
  });
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
  await ensurePreviousYearCarryover(prisma, userId, year);

  const {
    days,
    counts,
    allowance,
    anniversaryAllowance,
    localHolidayAllowance,
    previousYearAllowance,
    totalAllowance,
    enjoyed,
    remaining,
  } = await computeVacationYearData(prisma, userId, year);

  return {
    year,
    allowance,
    anniversaryAllowance,
    localHolidayAllowance,
    previousYearAllowance,
    totalAllowance,
    enjoyed,
    remaining: remaining >= 0 ? remaining : 0,
    counts,
    days: days.map((day: typeof days[number]) => ({ date: formatDateOnly(day.date), type: day.type })),
  };
}
