// backend/functions/dashboard.ts
import type { Prisma } from '@prisma/client';
import { createHttpHandler } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { nowInMadridDate, nowInMadridISO, toMadridISOString } from './_shared/timezone';

const YES_VALUES = ['Si', 'Sí'] as const;

type YesLabelField = 'caes_label' | 'fundae_label' | 'hotel_label' | 'po' | 'transporte';

function buildYesLabelFilter(field: YesLabelField): Prisma.dealsWhereInput {
  return {
    OR: YES_VALUES.map((value) => ({
      [field]: { equals: value, mode: 'insensitive' },
    })),
  } as Prisma.dealsWhereInput;
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

  const startOfDay = (value: Date): Date => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  };

  const addDays = (value: Date, amount: number): Date => {
    const date = new Date(value);
    date.setDate(date.getDate() + amount);
    return date;
  };

  const normalizeProductIdentifier = (value: string | null | undefined): string | null => {
    if (!value) return null;
    const normalized = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '')
      .toLowerCase();
    return normalized.length ? normalized : null;
  };

  const TWO_DAY_VERTICAL_PRODUCT_KEYS = new Set(['atrabajosverticales', 'trabajosverticales']);

  const isTwoDayVerticalProduct = (
    product:
      | {
          name: string | null;
          code: string | null;
          category: string | null;
        }
      | null
      | undefined,
  ): boolean => {
    if (!product) return false;
    const identifiers = [product.name, product.code, product.category]
      .map((value) => normalizeProductIdentifier(value))
      .filter((value): value is string => Boolean(value));
    return identifiers.some((identifier) => TWO_DAY_VERTICAL_PRODUCT_KEYS.has(identifier));
  };

  const normalizePipelineLabel = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .trim()
      .toLowerCase();
  };

  const toDateKey = (value: Date): string => {
    const iso = toMadridISOString(value);
    if (iso && iso.length >= 10) {
      return iso.slice(0, 10);
    }
    return value.toISOString().slice(0, 10);
  };

  const todayStart = startOfDay(now);
  const timelineStart = startOfDay(addDays(todayStart, -14));
  const timelineEnd = startOfDay(addDays(todayStart, 21));
  const timelineEndExclusive = addDays(timelineEnd, 1);

  try {
    const [
      draftSessions,
      suspendedSessions,
      pendingCompletionSessions,
      caesPending,
      fundaePending,
      hotelPending,
      poPending,
      transportPending,
      sessionsInTimeline,
      variantsInTimeline,
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
      prisma.sesiones.findMany({
        where: {
          fecha_inicio_utc: {
            gte: timelineStart,
            lt: timelineEndExclusive,
          },
        },
        select: {
          fecha_inicio_utc: true,
          deals: {
            select: {
              pipeline_id: true,
            },
          },
        },
      }),
      prisma.variants.findMany({
        where: {
          date: {
            not: null,
            gte: timelineStart,
            lt: timelineEndExclusive,
          },
        },
        select: {
          date: true,
          products: {
            select: {
              name: true,
              code: true,
              category: true,
            },
          },
        },
      }),
    ]);

    const timelineMap = new Map<
      string,
      { totalSessions: number; formacionAbiertaSessions: number }
    >();

    for (
      let cursor = new Date(timelineStart);
      cursor <= timelineEnd;
      cursor = addDays(cursor, 1)
    ) {
      timelineMap.set(toDateKey(cursor), {
        totalSessions: 0,
        formacionAbiertaSessions: 0,
      });
    }

    for (const session of sessionsInTimeline) {
      const sessionDateIso = toMadridISOString(session.fecha_inicio_utc ?? null);
      if (!sessionDateIso || sessionDateIso.length < 10) {
        continue;
      }
      const dateKey = sessionDateIso.slice(0, 10);
      const entry = timelineMap.get(dateKey);
      if (!entry) {
        continue;
      }
      entry.totalSessions += 1;
      const pipelineLabel = normalizePipelineLabel(session.deals?.pipeline_id ?? null);
      if (pipelineLabel === 'formacion abierta') {
        entry.formacionAbiertaSessions += 1;
      }
    }

    for (const variant of variantsInTimeline) {
      const variantDateValue = variant.date;
      const variantDate =
        variantDateValue instanceof Date
          ? variantDateValue
          : variantDateValue
            ? new Date(variantDateValue)
            : null;
      if (!variantDate || Number.isNaN(variantDate.getTime())) {
        continue;
      }

      const dateKey = toDateKey(variantDate);
      const entry = timelineMap.get(dateKey);
      if (entry) {
        entry.totalSessions += 1;
        entry.formacionAbiertaSessions += 1;
      }

      if (isTwoDayVerticalProduct(variant.products ?? null)) {
        const nextDayDate = addDays(variantDate, 1);
        const nextDateKey = toDateKey(nextDayDate);
        const nextEntry = timelineMap.get(nextDateKey);
        if (nextEntry) {
          nextEntry.totalSessions += 1;
          nextEntry.formacionAbiertaSessions += 1;
        }
      }
    }

    const timelinePoints = Array.from(timelineMap.entries()).map(
      ([date, values]) => ({
        date,
        totalSessions: values.totalSessions,
        formacionAbiertaSessions: values.formacionAbiertaSessions,
      }),
    );

    return successResponse({
      sessions: {
        borrador: draftSessions,
        suspendida: suspendedSessions,
        porFinalizar: pendingCompletionSessions,
      },
      followUp: {
        caesPorTrabajar: caesPending,
        fundaePorTrabajar: fundaePending,
        hotelPorTrabajar: hotelPending,
        poPorTrabajar: poPending,
        transportePorTrabajar: transportPending,
      },
      generatedAt: nowInMadridISO(),
      sessionsTimeline: {
        startDate: toDateKey(timelineStart),
        endDate: toDateKey(timelineEnd),
        points: timelinePoints,
      },
    });
  } catch (error) {
    console.error('[dashboard] Failed to compute metrics', error);
    return errorResponse('DASHBOARD_ERROR', 'No se pudieron cargar las métricas del dashboard', 500);
  }
});

