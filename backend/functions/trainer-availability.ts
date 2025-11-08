// backend/functions/trainer-availability.ts
import type { Prisma } from '@prisma/client';
import { createHttpHandler } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';

const MADRID_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function toMadridISO(date: Date): string {
  return MADRID_DATE_FORMATTER.format(date);
}

function parseYearParam(value: string | undefined): number | null {
  if (value === undefined) {
    return new Date().getFullYear();
  }
  const trimmed = value.trim();
  if (!trimmed.length) {
    return new Date().getFullYear();
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (parsed < 1970 || parsed > 2100) {
    return null;
  }
  return parsed;
}

function isWeekday(year: number, month: number, day: number): boolean {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

function toUtcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function parseDateInput(value: unknown): { year: number; month: number; day: number } | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [yearText, monthText, dayText] = trimmed.split('-');
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return { year, month, day };
}

function normalizeOverrides(rows: Array<{ date: Date; available: boolean }>) {
  return rows.map((row) => ({ date: toMadridISO(row.date), available: Boolean(row.available) }));
}

export const handler = createHttpHandler(async (request) => {
  const prisma = getPrisma();

  const auth = await requireAuth(request, prisma, { requireRoles: ['Formador'] });
  if ('error' in auth) {
    return auth.error;
  }

  const trainer = await prisma.trainers.findUnique({
    where: { user_id: auth.user.id },
    select: { trainer_id: true },
  });

  if (!trainer) {
    return errorResponse('NOT_FOUND', 'No se encontró el formador asociado al usuario actual', 404);
  }

  if (request.method === 'GET') {
    const requestedYear = parseYearParam(request.query.year);
    if (requestedYear === null) {
      return errorResponse('VALIDATION_ERROR', 'El parámetro year es inválido', 400);
    }

    const rows = await prisma.trainer_availability.findMany({
      where: {
        trainer_id: trainer.trainer_id,
        date: {
          gte: toUtcDate(requestedYear, 1, 1),
          lte: toUtcDate(requestedYear, 12, 31),
        },
      },
      orderBy: { date: 'asc' },
      select: { date: true, available: true },
    });

    return successResponse({
      availability: {
        year: requestedYear,
        overrides: normalizeOverrides(rows),
      },
    });
  }

  if (request.method === 'PUT') {
    const body = request.body && typeof request.body === 'object' ? (request.body as any) : {};
    const updates = Array.isArray(body?.updates) ? (body.updates as Array<{ date?: unknown; available?: unknown }>) : [];

    const normalizedUpdates = new Map<string, { available: boolean; year: number; month: number; day: number }>();

    for (const entry of updates) {
      const parsed = parseDateInput(entry?.date);
      if (!parsed) continue;
      const key = `${parsed.year}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`;
      normalizedUpdates.set(key, {
        available: Boolean(entry?.available),
        year: parsed.year,
        month: parsed.month,
        day: parsed.day,
      });
    }

    if (!normalizedUpdates.size) {
      return errorResponse('VALIDATION_ERROR', 'No se especificaron fechas válidas para actualizar', 400);
    }

    const years = new Set<number>();
    for (const value of normalizedUpdates.values()) {
      years.add(value.year);
    }
    if (years.size > 1) {
      return errorResponse('VALIDATION_ERROR', 'Todas las fechas deben pertenecer al mismo año', 400);
    }

    const year = years.values().next().value as number;

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const { available, year: y, month, day } of normalizedUpdates.values()) {
        const defaultAvailable = isWeekday(y, month, day);
        const dateUtc = toUtcDate(y, month, day);

        if (available === defaultAvailable) {
          try {
            await tx.trainer_availability.delete({
              where: { trainer_id_date: { trainer_id: trainer.trainer_id, date: dateUtc } },
            });
          } catch (_error) {
            // Ignorar si no existe (P2025)
          }
        } else {
          await tx.trainer_availability.upsert({
            where: { trainer_id_date: { trainer_id: trainer.trainer_id, date: dateUtc } },
            update: { available },
            create: { trainer_id: trainer.trainer_id, date: dateUtc, available },
          });
        }
      }
    });

    const rows = await prisma.trainer_availability.findMany({
      where: {
        trainer_id: trainer.trainer_id,
        date: {
          gte: toUtcDate(year, 1, 1),
          lte: toUtcDate(year, 12, 31),
        },
      },
      orderBy: { date: 'asc' },
      select: { date: true, available: true },
    });

    return successResponse({
      availability: {
        year,
        overrides: normalizeOverrides(rows),
      },
    });
  }

  if (request.method === 'OPTIONS') {
    return successResponse();
  }

  return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
});
