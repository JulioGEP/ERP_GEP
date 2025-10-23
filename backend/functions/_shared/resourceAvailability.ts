// backend/functions/_shared/resourceAvailability.ts
import type { Prisma, PrismaClient } from '@prisma/client';

import { errorResponse } from './response';
import { formatTimeFromDb } from './time';

export const ALWAYS_AVAILABLE_UNIT_IDS = new Set<string>(['52377f13-05dd-4830-88aa-0f5c78bee750']);

type DateRange = { start: Date; end: Date };

type TimeParts = { hour: number; minute: number };

type ResourceAvailabilityInput = {
  sessionId?: string;
  variantId?: string;
  trainerIds?: string[];
  unidadIds?: string[];
  salaId?: string | null;
  start?: Date | null;
  end?: Date | null;
};

function parseTimeParts(value: string | null | undefined): TimeParts | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
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
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  return new Date(Date.UTC(year, month, day, parts.hour, parts.minute, 0, 0));
}

function sanitizeIds(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  values.forEach((value) => {
    if (value == null) return;
    const text = String(value).trim();
    if (text.length) {
      seen.add(text);
    }
  });
  return Array.from(seen);
}

function hasOverlap(a: DateRange, b: DateRange): boolean {
  return a.start.getTime() <= b.end.getTime() && a.end.getTime() >= b.start.getTime();
}

export function normalizeDateRange(
  start?: Date | null,
  end?: Date | null,
): DateRange | null {
  const effectiveStart = start ?? end ?? null;
  const effectiveEnd = end ?? start ?? null;
  if (!effectiveStart || !effectiveEnd) return null;

  const startTime = effectiveStart.getTime();
  const endTime = effectiveEnd.getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null;
  if (endTime < startTime) return null;

  return {
    start: new Date(startTime),
    end: new Date(endTime),
  };
}

export function computeVariantDateRange(
  variantDate: Date | string | null | undefined,
  product: { hora_inicio: Date | string | null; hora_fin: Date | string | null },
): DateRange | null {
  if (!variantDate) return null;

  const parsedDate = variantDate instanceof Date ? new Date(variantDate) : new Date(String(variantDate));
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const startText = formatTimeFromDb(product.hora_inicio);
  const endText = formatTimeFromDb(product.hora_fin);

  const startTime = parseTimeParts(startText);
  const endTime = parseTimeParts(endText);

  const fallbackStart: TimeParts = startTime ?? { hour: 9, minute: 0 };
  const fallbackEnd: TimeParts = endTime ?? (startTime ? { ...startTime } : { hour: 11, minute: 0 });

  const start = buildDateTime(parsedDate, startTime, { hour: 9, minute: 0 });
  let end = buildDateTime(parsedDate, endTime, fallbackEnd);

  if (end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }

  return { start, end };
}

export async function ensureResourcesAvailable(
  tx: Prisma.TransactionClient | PrismaClient,
  {
    sessionId,
    variantId,
    trainerIds: trainerIdsInput,
    unidadIds: unidadIdsInput,
    salaId,
    start,
    end,
  }: ResourceAvailabilityInput,
): Promise<void> {
  const range = normalizeDateRange(start ?? null, end ?? null);
  if (!range) return;

  const trainerIds = sanitizeIds(trainerIdsInput);
  const unidadIds = sanitizeIds(unidadIdsInput).filter((id) => !ALWAYS_AVAILABLE_UNIT_IDS.has(id));
  const normalizedSalaId = salaId ? String(salaId).trim() : '';

  if (!trainerIds.length && !unidadIds.length && !normalizedSalaId) {
    return;
  }

  const sessionConditions: Prisma.sessionsWhereInput[] = [];
  if (trainerIds.length) {
    sessionConditions.push({ trainers: { some: { trainer_id: { in: trainerIds } } } });
  }
  if (unidadIds.length) {
    sessionConditions.push({ unidades: { some: { unidad_id: { in: unidadIds } } } });
  }
  if (normalizedSalaId) {
    sessionConditions.push({ sala_id: normalizedSalaId });
  }

  if (sessionConditions.length) {
    const sessions = await tx.sessions.findMany({
      where: {
        ...(sessionId ? { id: { not: sessionId } } : {}),
        OR: sessionConditions,
      },
      select: {
        id: true,
        fecha_inicio_utc: true,
        fecha_fin_utc: true,
        sala_id: true,
        trainers: { select: { trainer_id: true } },
        unidades: { select: { unidad_id: true } },
      },
    });

    const conflictingSession = sessions.find((session) => {
      const sessionRange = normalizeDateRange(session.fecha_inicio_utc, session.fecha_fin_utc);
      return sessionRange ? hasOverlap(sessionRange, range) : false;
    });

    if (conflictingSession) {
      throw errorResponse(
        'RESOURCE_UNAVAILABLE',
        'Algunos recursos ya están asignados en las fechas seleccionadas.',
        409,
      );
    }
  }

  const variantConditions: Prisma.variantsWhereInput[] = [];
  if (trainerIds.length) {
    variantConditions.push({ trainer_id: { in: trainerIds } });
  }
  if (unidadIds.length) {
    variantConditions.push({ unidad_movil_id: { in: unidadIds } });
  }
  if (normalizedSalaId) {
    variantConditions.push({ sala_id: normalizedSalaId });
  }

  if (!variantConditions.length) {
    return;
  }

  const variants = await tx.variants.findMany({
    where: {
      date: { not: null },
      ...(variantId ? { id: { not: variantId } } : {}),
      OR: variantConditions,
    },
    select: {
      id: true,
      date: true,
      trainer_id: true,
      unidad_movil_id: true,
      sala_id: true,
      product: {
        select: {
          hora_inicio: true,
          hora_fin: true,
        },
      },
    },
  });

  const conflictingVariant = variants.find((variant) => {
    const variantRange = computeVariantDateRange(variant.date, {
      hora_inicio: variant.product?.hora_inicio ?? null,
      hora_fin: variant.product?.hora_fin ?? null,
    });
    if (!variantRange) return false;
    return hasOverlap(variantRange, range);
  });

  if (conflictingVariant) {
    throw errorResponse(
      'RESOURCE_UNAVAILABLE',
      'Algunos recursos ya están asignados en las fechas seleccionadas.',
      409,
    );
  }
}
