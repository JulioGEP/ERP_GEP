// backend/functions/_shared/vacations.ts
import type { PrismaClient } from '@prisma/client';

export const VACATION_TYPES = new Set(['V', 'L', 'A', 'T', 'M', 'H', 'F', 'R', 'P', 'I', 'N', 'C', 'Y']);

export type VacationCounts = Record<'V' | 'L' | 'A' | 'T' | 'M' | 'H' | 'F' | 'R' | 'P' | 'I' | 'N' | 'C' | 'Y', number>;

export const DEFAULT_VACATION_ALLOWANCE = 24;
export const THIRTY_THREE_DAYS_VACATION_ALLOWANCE = 33;
export const DEFAULT_ANNIVERSARY_ALLOWANCE = 1;
export const DEFAULT_LOCAL_HOLIDAY_ALLOWANCE = 2;
export const DEFAULT_PREVIOUS_YEAR_ALLOWANCE = 0;

const HOLIDAY_TYPES = new Set(['L', 'N', 'C']);

function isWeekday(date: Date): boolean {
  const dayOfWeek = date.getUTCDay();
  return dayOfWeek !== 0 && dayOfWeek !== 6;
}

export function getEffectiveVacationDays(
  days: Array<{ date: Date; type: string }>,
  options?: { countNaturalVacationDays?: boolean },
): { effectiveVacationDays: number; counts: VacationCounts } {
  const counts: VacationCounts = { V: 0, L: 0, A: 0, T: 0, M: 0, H: 0, F: 0, R: 0, P: 0, I: 0, N: 0, C: 0, Y: 0 };
  const holidayDates = new Set<string>();

  for (const day of days) {
    if (HOLIDAY_TYPES.has(day.type)) {
      holidayDates.add(formatDateOnly(day.date));
    }
  }

  const countNaturalVacationDays = options?.countNaturalVacationDays === true;
  let effectiveVacationDays = 0;

  for (const day of days) {
    const key = day.type as keyof VacationCounts;
    if (counts[key] === undefined) {
      continue;
    }

    if (day.type !== 'V') {
      counts[key] += 1;
      continue;
    }

    const dateOnly = formatDateOnly(day.date);
    const isBusinessVacationDay = isWeekday(day.date) && !holidayDates.has(dateOnly);
    if (countNaturalVacationDays || isBusinessVacationDay) {
      counts.V += 1;
      effectiveVacationDays += 1;
    }
  }

  return { effectiveVacationDays, counts };
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

  const [days, balance, trainer] = await Promise.all([
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
    prisma.trainers.findFirst({
      where: { user_id: userId },
      select: { treintaytres: true },
    }),
  ]);

  const hasThirtyThreeDays = trainer?.treintaytres === true;
  const { effectiveVacationDays, counts } = getEffectiveVacationDays(days, {
    countNaturalVacationDays: hasThirtyThreeDays,
  });
  const enjoyed = effectiveVacationDays + counts.A + counts.Y;
  const allowance =
    typeof balance?.allowance_days === 'number'
      ? balance.allowance_days
      : hasThirtyThreeDays
        ? THIRTY_THREE_DAYS_VACATION_ALLOWANCE
        : DEFAULT_VACATION_ALLOWANCE;
  const anniversaryAllowance =
    typeof balance?.anniversary_days === 'number' ? balance.anniversary_days : DEFAULT_ANNIVERSARY_ALLOWANCE;
  const localHolidayAllowance =
    typeof balance?.local_holiday_days === 'number' ? balance.local_holiday_days : DEFAULT_LOCAL_HOLIDAY_ALLOWANCE;
  const previousYearAllowance =
    typeof balance?.previous_year_days === 'number' ? balance.previous_year_days : DEFAULT_PREVIOUS_YEAR_ALLOWANCE;

  const totalAllowance = allowance + anniversaryAllowance + previousYearAllowance;
  const remaining = totalAllowance - enjoyed;

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
