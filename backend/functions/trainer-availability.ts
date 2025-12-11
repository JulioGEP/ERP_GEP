// backend/functions/trainer-availability.ts
import type { Prisma, PrismaClient } from '@prisma/client';
import { createHttpHandler } from './_shared/http';
import { hasPermission, requireAuth } from './_shared/auth';
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
  return rows
    .filter((row) => row.available === false)
    .map((row) => ({ date: toMadridISO(row.date), available: false }));
}

function isMissingRelationError(error: unknown, relation: string): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message || '';
  const pattern = new RegExp(`\\b${relation}\\b`, 'i');
  return pattern.test(message);
}

function addDateIfMatchesYear(target: Set<string>, date: Date | null | undefined, year: number) {
  if (!date) return;
  const iso = toMadridISO(date);
  if (!iso.startsWith(`${year}-`)) return;
  target.add(iso);
}

type PrismaClientLike = PrismaClient | Prisma.TransactionClient;

async function computeAssignedDates(
  client: PrismaClientLike,
  trainerId: string,
  year: number,
  startOfYearUtc: Date,
  startOfNextYearUtc: Date,
): Promise<string[]> {
  const assignments = new Set<string>();

  const sessionRows = await client.sesiones.findMany({
    where: {
      sesion_trainers: { some: { trainer_id: trainerId } },
      OR: [
        { fecha_inicio_utc: { gte: startOfYearUtc, lt: startOfNextYearUtc } },
        { fecha_fin_utc: { gte: startOfYearUtc, lt: startOfNextYearUtc } },
      ],
    },
    select: { fecha_inicio_utc: true, fecha_fin_utc: true },
  });

  for (const session of sessionRows) {
    addDateIfMatchesYear(assignments, session.fecha_inicio_utc, year);
    addDateIfMatchesYear(assignments, session.fecha_fin_utc, year);
  }

  const processedVariantIds = new Set<string>();

  const directVariantRows = await client.variants.findMany({
    where: {
      trainer_id: trainerId,
      date: { gte: startOfYearUtc, lt: startOfNextYearUtc },
    },
    select: { id: true, date: true },
  });

  for (const variant of directVariantRows) {
    processedVariantIds.add(variant.id);
    addDateIfMatchesYear(assignments, variant.date, year);
  }

  const linkedVariantIds = new Set<string>();

  try {
    const rows = (await client.$queryRaw<{ variant_id: string }[]>`
      SELECT variant_id::text AS variant_id
      FROM variant_trainer_links
      WHERE trainer_id = ${trainerId}
    `) as Array<{ variant_id: string }>;

    for (const row of rows) {
      if (row.variant_id) {
        linkedVariantIds.add(row.variant_id);
      }
    }
  } catch (error) {
    if (!isMissingRelationError(error, 'variant_trainer_links')) {
      throw error;
    }
  }

  const missingVariantIds = Array.from(linkedVariantIds).filter((id) => !processedVariantIds.has(id));

  if (missingVariantIds.length > 0) {
    const linkedVariants = await client.variants.findMany({
      where: {
        id: { in: missingVariantIds },
        date: { gte: startOfYearUtc, lt: startOfNextYearUtc },
      },
      select: { id: true, date: true },
    });

    for (const variant of linkedVariants) {
      processedVariantIds.add(variant.id);
      addDateIfMatchesYear(assignments, variant.date, year);
    }
  }

  return Array.from(assignments).sort((a, b) => a.localeCompare(b));
}

async function buildTrainerAvailability(
  client: PrismaClientLike,
  trainerId: string,
  year: number,
): Promise<{
  year: number;
  overrides: Array<{ date: string; available: boolean }>;
  assignedDates: string[];
}> {
  const startOfYearUtc = toUtcDate(year, 1, 1);
  const startOfNextYearUtc = toUtcDate(year + 1, 1, 1);

  const overrideRows = await client.trainer_availability.findMany({
    where: {
      trainer_id: trainerId,
      date: {
        gte: startOfYearUtc,
        lt: startOfNextYearUtc,
      },
    },
    orderBy: { date: 'asc' },
    select: { date: true, available: true },
  });

  const overrides = normalizeOverrides(overrideRows);
  const assignedDates = await computeAssignedDates(client, trainerId, year, startOfYearUtc, startOfNextYearUtc);

  return { year, overrides, assignedDates };
}

export const handler = createHttpHandler(async (request) => {
  const prisma = getPrisma();

  const auth = await requireAuth(request, prisma);
  if ('error' in auth) {
    return auth.error;
  }

  const canManageOthers = hasPermission('/recursos/formadores_bomberos', auth.permissions);

  const ownTrainer = await prisma.trainers.findUnique({
    where: { user_id: auth.user.id },
    select: { trainer_id: true },
  });

  const requestedTrainerId = typeof request.query.trainer_id === 'string' ? request.query.trainer_id.trim() : null;

  if (!canManageOthers && requestedTrainerId && requestedTrainerId !== ownTrainer?.trainer_id) {
    return errorResponse('FORBIDDEN', 'No tienes permiso para gestionar otros formadores', 403);
  }

  const trainerId = requestedTrainerId || ownTrainer?.trainer_id;

  if (!trainerId) {
    return errorResponse('NOT_FOUND', 'No se encontró el formador asociado', 404);
  }

  const targetTrainer = await prisma.trainers.findUnique({ where: { trainer_id: trainerId }, select: { trainer_id: true } });

  if (!targetTrainer) {
    return errorResponse('NOT_FOUND', 'No se encontró el formador especificado', 404);
  }

  if (request.method === 'GET') {
    const requestedYear = parseYearParam(request.query.year);
    if (requestedYear === null) {
      return errorResponse('VALIDATION_ERROR', 'El parámetro year es inválido', 400);
    }

    const availability = await buildTrainerAvailability(prisma, trainerId, requestedYear);

    return successResponse({ availability });
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
        const defaultAvailable = true;
        const dateUtc = toUtcDate(y, month, day);

        if (available === defaultAvailable) {
          try {
            await tx.trainer_availability.delete({
              where: { trainer_id_date: { trainer_id: trainerId, date: dateUtc } },
            });
          } catch (_error) {
            // Ignorar si no existe (P2025)
          }
        } else {
          await tx.trainer_availability.upsert({
            where: { trainer_id_date: { trainer_id: trainerId, date: dateUtc } },
            update: { available },
            create: { trainer_id: trainerId, date: dateUtc, available },
          });
        }
      }
    });

    const availability = await buildTrainerAvailability(prisma, trainerId, year);

    return successResponse({ availability });
  }

  if (request.method === 'OPTIONS') {
    return successResponse();
  }

  return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
});
