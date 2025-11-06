import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';

type SessionTrainerRow = {
  trainer_id: string;
  sesiones: { fecha_inicio_utc: Date | null; fecha_fin_utc: Date | null } | null;
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

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ['Admin'] });
  if ('error' in auth) {
    return auth.error;
  }

  const rows = (await prisma.sesion_trainers.findMany({
    where: {
      sesiones: {
        fecha_inicio_utc: { not: null },
        fecha_fin_utc: { not: null },
      },
    },
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
