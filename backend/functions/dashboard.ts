// backend/functions/dashboard.ts
import type { Prisma } from '@prisma/client';
import { createHttpHandler } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { buildMadridDateTime } from './_shared/time';
import { nowInMadridDate, nowInMadridISO, toMadridISOString } from './_shared/timezone';

const YES_VALUES = ['Si', 'Sí'] as const;

type YesLabelField = 'caes_label' | 'fundae_label' | 'hotel_label' | 'po' | 'transporte';

const DAYS_BACK = 14;
const DAYS_FORWARD = 21;

function buildYesLabelFilter(field: YesLabelField): Prisma.dealsWhereInput {
  return {
    OR: YES_VALUES.map((value) => ({
      [field]: { equals: value, mode: 'insensitive' },
    })),
  } as Prisma.dealsWhereInput;
}

function toMadridDateParts(date: Date): { year: number; month: number; day: number } {
  const iso = toMadridISOString(date);
  if (iso) {
    const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return {
        year: Number.parseInt(match[1], 10),
        month: Number.parseInt(match[2], 10),
        day: Number.parseInt(match[3], 10),
      };
    }
  }
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function startOfMadridDay(date: Date): Date {
  const parts = toMadridDateParts(date);
  return buildMadridDateTime({ ...parts, hour: 0, minute: 0 });
}

function addMadridDays(date: Date, amount: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + amount);
  return result;
}

function formatMadridDateKey(date: Date): string {
  const iso = toMadridISOString(date);
  if (iso) {
    return iso.slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma);

  if ('error' in auth) {
    return auth.error;
  }

  const now = nowInMadridDate();

  try {
    const startDay = startOfMadridDay(now);
    const rangeStart = addMadridDays(startDay, -DAYS_BACK);
    const rangeEnd = addMadridDays(startDay, DAYS_FORWARD + 1);

    const [
      draftSessions,
      suspendedSessions,
      pendingCompletionSessions,
      caesPending,
      fundaePending,
      hotelPending,
      poPending,
      transportPending,
      openTrainingUnassignedVariants,
      sessionCounts,
      variantCounts,
    ] = await Promise.all([
      prisma.sesiones.count({ where: { estado: 'BORRADOR' } }),
      prisma.sesiones.count({ where: { estado: 'SUSPENDIDA' } }),
      prisma.sesiones.count({
        where: {
          estado: { not: 'FINALIZADA' },
          fecha_fin_utc: { not: null, lt: now },
        },
      }),
      prisma.deals.count({
        where: {
          ...buildYesLabelFilter('caes_label'),
          caes_val: false,
        },
      }),
      prisma.deals.count({
        where: {
          ...buildYesLabelFilter('fundae_label'),
          fundae_val: false,
        },
      }),
      prisma.deals.count({
        where: {
          ...buildYesLabelFilter('hotel_label'),
          hotel_val: false,
        },
      }),
      prisma.deals.count({
        where: {
          ...buildYesLabelFilter('po'),
          po_val: false,
        },
      }),
      prisma.deals.count({
        where: {
          ...buildYesLabelFilter('transporte'),
          transporte_val: false,
        },
      }),
      prisma.variants.count({
        where: {
          trainer_id: null,
          sala_id: null,
          product: {
            category: { equals: 'Formación Abierta', mode: 'insensitive' },
          },
        },
      }),
      prisma.$queryRaw<Array<{ day: string; total: bigint }>>`
        SELECT
          to_char((s.fecha_inicio_utc AT TIME ZONE 'Europe/Madrid')::date, 'YYYY-MM-DD') AS day,
          COUNT(*)::bigint AS total
        FROM sesiones s
        WHERE s.fecha_inicio_utc IS NOT NULL
          AND s.fecha_inicio_utc >= ${rangeStart}
          AND s.fecha_inicio_utc < ${rangeEnd}
        GROUP BY day
      `,
      prisma.$queryRaw<Array<{ day: string; total: bigint }>>`
        SELECT
          to_char((v.date AT TIME ZONE 'Europe/Madrid')::date, 'YYYY-MM-DD') AS day,
          COUNT(*)::bigint AS total
        FROM variants v
        JOIN products p ON p.id_woo = v.id_padre
        WHERE v.date IS NOT NULL
          AND v.date >= (${rangeStart} AT TIME ZONE 'Europe/Madrid')
          AND v.date < (${rangeEnd} AT TIME ZONE 'Europe/Madrid')
          AND p.category ILIKE 'Formación Abierta'
        GROUP BY day
      `,
    ]);

    const sessionCountMap = new Map<string, number>();
    sessionCounts.forEach((row) => {
      const key = typeof row.day === 'string' ? row.day.trim() : '';
      if (!key) return;
      sessionCountMap.set(key, Number(row.total ?? 0));
    });

    const variantCountMap = new Map<string, number>();
    variantCounts.forEach((row) => {
      const key = typeof row.day === 'string' ? row.day.trim() : '';
      if (!key) return;
      variantCountMap.set(key, Number(row.total ?? 0));
    });

    const totalDays = DAYS_BACK + DAYS_FORWARD + 1;
    const trendPoints: Array<{
      fecha: string;
      totalSesiones: number;
      totalVariantesFormacionAbierta: number;
    }> = [];

    for (let index = 0; index < totalDays; index += 1) {
      const currentDay = addMadridDays(rangeStart, index);
      const key = formatMadridDateKey(currentDay);
      trendPoints.push({
        fecha: key,
        totalSesiones: sessionCountMap.get(key) ?? 0,
        totalVariantesFormacionAbierta: variantCountMap.get(key) ?? 0,
      });
    }

    return successResponse({
      sessions: {
        borrador: draftSessions,
        suspendida: suspendedSessions,
        porFinalizar: pendingCompletionSessions,
        formacionAbiertaSinAsignar: openTrainingUnassignedVariants,
      },
      followUp: {
        caesPorTrabajar: caesPending,
        fundaePorTrabajar: fundaePending,
        hotelPorTrabajar: hotelPending,
        poPorTrabajar: poPending,
        transportePorTrabajar: transportPending,
      },
      generatedAt: nowInMadridISO(),
      tendencias: {
        sesionesVsVariantes: trendPoints,
      },
    });
  } catch (error) {
    console.error('[dashboard] Failed to compute metrics', error);
    return errorResponse('DASHBOARD_ERROR', 'No se pudieron cargar las métricas del dashboard', 500);
  }
});

