import type { Prisma } from '@prisma/client';

import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { buildMadridDateTime, formatTimeFromDb } from './_shared/time';

type SessionTrainerRow = {
  trainer_id: string;
  sesiones: { fecha_inicio_utc: Date | null; fecha_fin_utc: Date | null } | null;
  trainers: { trainer_id: string; name: string | null; apellido: string | null } | null;
};

type VariantTrainerRow = {
  trainer_id: string | null;
  date: Date | string | null;
  products: { hora_inicio: Date | string | null; hora_fin: Date | string | null } | null;
  trainers: { trainer_id: string; name: string | null; apellido: string | null } | null;
};

type TrainerHoursAccumulator = {
  trainerId: string;
  name: string | null;
  lastName: string | null;
  sessionCount: number;
  totalHours: number;
};

function computeSessionHours(start: Date | null, end: Date | null): number {
  if (!start || !end) return 0;
  const startTime = start.getTime();
  const endTime = end.getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 0;
  const diff = endTime - startTime;
  if (!Number.isFinite(diff) || diff <= 0) return 0;
  return diff / (60 * 60 * 1000);
}

function normalizeName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

type TimeParts = { hour: number; minute: number };

function extractTimeParts(value: Date | string | null | undefined): TimeParts | null {
  const formatted = formatTimeFromDb(value);
  if (!formatted) return null;
  const match = formatted.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function buildDateTime(date: Date, time: TimeParts | null, fallback: TimeParts): Date {
  const parts = time ?? fallback;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return buildMadridDateTime({ year, month, day, hour: parts.hour, minute: parts.minute });
}

function computeVariantHours(
  variantDate: Date | string | null | undefined,
  productTimes: { hora_inicio: Date | string | null; hora_fin: Date | string | null },
): number {
  if (!variantDate) return 0;

  const parsedDate = new Date(variantDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return 0;
  }

  const startTime = extractTimeParts(productTimes.hora_inicio);
  const endTime = extractTimeParts(productTimes.hora_fin);

  const fallbackStart: TimeParts = startTime ?? { hour: 9, minute: 0 };
  const fallbackEnd: TimeParts = endTime ?? (startTime ? { ...startTime } : { hour: 11, minute: 0 });

  const start = buildDateTime(parsedDate, startTime, fallbackStart);
  let end = buildDateTime(parsedDate, endTime, fallbackEnd);

  if (end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }

  const diff = end.getTime() - start.getTime();
  if (!Number.isFinite(diff) || diff <= 0) {
    return 0;
  }

  return diff / (60 * 60 * 1000);
}

type ParsedDateFilters =
  | { startDate: Date | null; endDate: Date | null }
  | { error: ReturnType<typeof errorResponse> };

function parseDateParts(value: string): { year: number; month: number; day: number } | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  const reference = new Date(Date.UTC(year, month - 1, day));
  if (
    reference.getUTCFullYear() !== year ||
    reference.getUTCMonth() !== month - 1 ||
    reference.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function parseDateFilters(query: Record<string, string | undefined>): ParsedDateFilters {
  const startText = query.startDate?.trim() ?? '';
  const endText = query.endDate?.trim() ?? '';

  let startDate: Date | null = null;
  let endDate: Date | null = null;

  if (startText) {
    const parts = parseDateParts(startText);
    if (!parts) {
      return {
        error: errorResponse('INVALID_DATE', 'La fecha de inicio proporcionada no es válida.', 400),
      };
    }
    startDate = buildMadridDateTime({
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: 0,
      minute: 0,
    });
  }

  if (endText) {
    const parts = parseDateParts(endText);
    if (!parts) {
      return {
        error: errorResponse('INVALID_DATE', 'La fecha de fin proporcionada no es válida.', 400),
      };
    }
    endDate = buildMadridDateTime({
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: 23,
      minute: 59,
    });
  }

  if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
    return {
      error: errorResponse(
        'INVALID_DATE_RANGE',
        'La fecha de inicio no puede ser posterior a la fecha de fin.',
        400,
      ),
    };
  }

  return { startDate, endDate };
}

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ['Admin'] });
  if ('error' in auth) {
    return auth.error;
  }

  const parsedDates = parseDateFilters(request.query);
  if ('error' in parsedDates) {
    return parsedDates.error;
  }

  const { startDate, endDate } = parsedDates;

  const sessionStartFilter: { not: null; gte?: Date; lte?: Date } = { not: null };
  if (startDate) {
    sessionStartFilter.gte = startDate;
  }
  if (endDate) {
    sessionStartFilter.lte = endDate;
  }

  const sessionEndFilter: { not: null; gte?: Date; lte?: Date } = { not: null };

  const sessionWhere = {
    sesiones: {
      fecha_inicio_utc: sessionStartFilter,
      fecha_fin_utc: sessionEndFilter,
    },
  };

  const variantDateFilter: { not: null; gte?: Date; lte?: Date } = { not: null };
  if (startDate) {
    variantDateFilter.gte = startDate;
  }
  if (endDate) {
    variantDateFilter.lte = endDate;
  }

  const rows = (await prisma.sesion_trainers.findMany({
    where: sessionWhere,
    select: {
      trainer_id: true,
      sesiones: {
        select: {
          fecha_inicio_utc: true,
          fecha_fin_utc: true,
        },
      },
      trainers: {
        select: {
          trainer_id: true,
          name: true,
          apellido: true,
        },
      },
    },
  })) as SessionTrainerRow[];

  const variantRows = (await prisma.variants.findMany({
    where: {
      trainer_id: { not: null },
      date: variantDateFilter,
    },
    select: {
      trainer_id: true,
      date: true,
      products: { select: { hora_inicio: true, hora_fin: true } },
      trainers: { select: { trainer_id: true, name: true, apellido: true } },
    },
  })) as VariantTrainerRow[];

  const totals = new Map<string, TrainerHoursAccumulator>();

  for (const row of rows) {
    const trainerId = row.trainer_id || row.trainers?.trainer_id;
    if (!trainerId) {
      continue;
    }

    const hours = computeSessionHours(
      row.sesiones?.fecha_inicio_utc ?? null,
      row.sesiones?.fecha_fin_utc ?? null,
    );

    const existing = totals.get(trainerId);
    if (existing) {
      existing.sessionCount += 1;
      existing.totalHours += hours;
      if (existing.name === null && normalizeName(row.trainers?.name)) {
        existing.name = normalizeName(row.trainers?.name);
      }
      if (existing.lastName === null && normalizeName(row.trainers?.apellido)) {
        existing.lastName = normalizeName(row.trainers?.apellido);
      }
      continue;
    }

    totals.set(trainerId, {
      trainerId,
      name: normalizeName(row.trainers?.name),
      lastName: normalizeName(row.trainers?.apellido),
      sessionCount: 1,
      totalHours: hours,
    });
  }

  for (const row of variantRows) {
    const trainerId = row.trainer_id || row.trainers?.trainer_id;
    if (!trainerId) {
      continue;
    }

    const hours = computeVariantHours(row.date, row.products ?? { hora_inicio: null, hora_fin: null });

    const existing = totals.get(trainerId);
    if (existing) {
      existing.sessionCount += 1;
      existing.totalHours += hours;
      if (existing.name === null && normalizeName(row.trainers?.name)) {
        existing.name = normalizeName(row.trainers?.name);
      }
      if (existing.lastName === null && normalizeName(row.trainers?.apellido)) {
        existing.lastName = normalizeName(row.trainers?.apellido);
      }
      continue;
    }

    totals.set(trainerId, {
      trainerId,
      name: normalizeName(row.trainers?.name),
      lastName: normalizeName(row.trainers?.apellido),
      sessionCount: 1,
      totalHours: hours,
    });
  }

  const items = Array.from(totals.values())
    .map((item) => ({
      trainerId: item.trainerId,
      name: item.name,
      lastName: item.lastName,
      sessionCount: item.sessionCount,
      totalHours: Math.round(item.totalHours * 100) / 100,
    }))
    .sort((a, b) => {
      if (b.totalHours !== a.totalHours) {
        return b.totalHours - a.totalHours;
      }
      if (b.sessionCount !== a.sessionCount) {
        return b.sessionCount - a.sessionCount;
      }
      return a.trainerId.localeCompare(b.trainerId);
    });

  const totalSessions = items.reduce((acc, item) => acc + item.sessionCount, 0);
  const totalHours = Math.round(items.reduce((acc, item) => acc + item.totalHours, 0) * 100) / 100;

  return successResponse({
    items,
    summary: {
      totalSessions,
      totalHours,
    },
  });
});
