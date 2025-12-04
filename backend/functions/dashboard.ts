// backend/functions/dashboard.ts
import { createHttpHandler } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { nowInMadridDate, nowInMadridISO, toMadridISOString } from './_shared/timezone';

const YES_VALUES = ['Si', 'Sí'] as const;
const SESSION_PIPELINE_LABELS = [
  'formacion empresa',
  'formacion empresas',
  'formación empresa',
  'formación empresas',
  'gep services',
] as const;

type YesLabelField = 'caes_label' | 'fundae_label' | 'hotel_label' | 'po' | 'transporte';

type DealsWhereFilter = Record<string, unknown>;

function buildYesLabelFilter(field: YesLabelField): DealsWhereFilter {
  return {
    OR: YES_VALUES.map((value) => ({
      [field]: { equals: value, mode: 'insensitive' },
    })),
  };
}

const pipelineConditions = SESSION_PIPELINE_LABELS.map((label) => ({
  pipeline_id: { equals: label, mode: 'insensitive' as const },
}));

function buildSessionPipelineFilter() {
  return { is: { OR: pipelineConditions } };
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

  const normalizeVariantWooId = (value: unknown): string | null => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length ? trimmed : null;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? String(value) : null;
    }
    if (typeof value === 'bigint') {
      return value.toString();
    }
    if (value && typeof value === 'object' && 'toString' in value) {
      const serialized = String(value).trim();
      return serialized.length ? serialized : null;
    }
    return null;
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
      unplannedSessions,
      sessionsWithoutTrainer,
      draftBudgetsWithDraftSession,
      suspendedBudgets,
      pendingCompletionBudgets,
      caesPending,
      fundaePending,
      hotelPending,
      poPending,
      transportPending,
      sessionsInTimeline,
      variantsInTimeline,
      variantsMissingTrainer,
    ] = await Promise.all([
      prisma.sesiones.count({
        where: {
          fecha_inicio_utc: null,
          fecha_fin_utc: null,
          sesion_trainers: { none: {} },
          deals: { is: { OR: pipelineConditions, w_id_variation: null } },
        },
      }),
      prisma.sesiones.count({
        where: {
          estado: { notIn: ['PLANIFICADA', 'FINALIZADA'] },
          fecha_inicio_utc: { not: null },
          fecha_fin_utc: { not: null },
          sesion_trainers: { none: {} },
          deals: {
            is: {
              OR: pipelineConditions,
              w_id_variation: null,
              sesiones: { some: { estado: 'BORRADOR' } },
            },
          },
        },
      }),
      prisma.sesiones.findMany({
        where: {
          estado: 'BORRADOR',
          deals: buildSessionPipelineFilter(),
        },
        distinct: ['deal_id'],
        select: { deal_id: true },
      }),
      prisma.deals.count({
        where: {
          sesiones: {
            some: { estado: 'SUSPENDIDA' },
          },
        },
      }),
      prisma.deals.count({
        where: {
          sesiones: {
            some: {
              estado: 'PLANIFICADA',
              fecha_fin_utc: { not: null, lt: todayStart },
            },
          },
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
          id: true,
          fecha_inicio_utc: true,
          nombre_cache: true,
          deals: {
            select: {
              deal_id: true,
              pipeline_id: true,
              title: true,
              organizations: {
                select: {
                  name: true,
                },
              },
            },
          },
          sesion_trainers: {
            select: {
              trainers: {
                select: {
                  name: true,
                },
              },
            },
          },
          sesion_unidades: {
            select: {
              unidades_moviles: {
                select: {
                  name: true,
                },
              },
            },
          },
          _count: {
            select: {
              alumnos: true,
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
          id_woo: true,
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
      prisma.variants.findMany({
        where: {
          trainer_id: null,
          date: { not: null, gte: todayStart },
        },
        select: {
          id_woo: true,
        },
      }),
    ]);

    const draftBudgets = draftBudgetsWithDraftSession.length;

    type SessionTimelineEntry = {
      id: string;
      fecha_inicio_utc: Date | null;
      nombre_cache: string | null;
      deals: {
        deal_id: string | null;
        pipeline_id: string | null;
        title: string | null;
        organizations: { name: string | null } | null;
      } | null;
      sesion_trainers: Array<{ trainers: { name: string | null } | null }> | null;
      sesion_unidades: Array<{ unidades_moviles: { name: string | null } | null }> | null;
      _count: { alumnos: number } | null;
    };

    const timelineSessions = sessionsInTimeline as SessionTimelineEntry[];

    type VariantWithoutTrainerEntry = { id_woo: bigint | number | string | null };

    const variantsWithoutTrainerList = variantsMissingTrainer as VariantWithoutTrainerEntry[];

    let variantsWithoutTrainerWithDeals = 0;

    if (variantsWithoutTrainerList.length) {
      const variantIds = Array.from(
        new Set(
          variantsWithoutTrainerList
            .map((variant) => normalizeVariantWooId(variant?.id_woo ?? null))
            .filter((value): value is string => Boolean(value)),
        ),
      );

      if (variantIds.length) {
        type VariantDealIdRow = { w_id_variation: string | number | bigint | null };

        const dealsForMissingTrainer = await prisma.deals.findMany({
          where: { w_id_variation: { in: variantIds } },
          select: { w_id_variation: true },
        });

        const dealsVariantIds = new Set(
          (dealsForMissingTrainer as VariantDealIdRow[])
            .map((deal) => normalizeVariantWooId(deal?.w_id_variation ?? null))
            .filter((value): value is string => Boolean(value)),
        );

        variantsWithoutTrainerWithDeals = variantIds.filter((id) => dealsVariantIds.has(id)).length;
      }
    }

    type TimelineBudgetEntry = {
      id: string;
      dealId: string | null;
      sessionTitle: string | null;
      companyName: string | null;
      trainers: string[];
      mobileUnits: string[];
      type: 'company' | 'formacionAbierta';
      studentsCount: number;
    };

    const timelineMap = new Map<
      string,
      {
        totalSessions: number;
        formacionAbiertaSessions: number;
        budgets: TimelineBudgetEntry[];
      }
    >();

    for (
      let cursor = new Date(timelineStart);
      cursor <= timelineEnd;
      cursor = addDays(cursor, 1)
    ) {
      timelineMap.set(toDateKey(cursor), {
        totalSessions: 0,
        formacionAbiertaSessions: 0,
        budgets: [],
      });
    }

    for (const session of timelineSessions) {
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

      const trainers = Array.isArray(session.sesion_trainers)
        ? session.sesion_trainers
            .map((entry) => entry.trainers?.name?.trim())
            .filter((value): value is string => Boolean(value))
        : [];

      const mobileUnits = Array.isArray(session.sesion_unidades)
        ? session.sesion_unidades
            .map((entry) => entry.unidades_moviles?.name?.trim())
            .filter((value): value is string => Boolean(value))
        : [];

      const totalStudents = Number.isFinite(session._count?.alumnos)
        ? session._count?.alumnos ?? 0
        : 0;
      const budgetType = pipelineLabel === 'formacion abierta' ? 'formacionAbierta' : 'company';

      entry.budgets.push({
        id: session.id,
        dealId: session.deals?.deal_id ?? null,
        sessionTitle: session.nombre_cache ?? session.deals?.title ?? null,
        companyName: session.deals?.organizations?.name ?? null,
        trainers,
        mobileUnits,
        type: budgetType,
        studentsCount: totalStudents,
      });
    }

    type VariantTimelineEntry = {
      id_woo: bigint | number | string | null;
      date: Date | string | null;
      products:
        | {
            name: string | null;
            code: string | null;
            category: string | null;
          }
        | null;
    };

    const variantEntries = variantsInTimeline as VariantTimelineEntry[];
    const variantWooIds = Array.from(
      new Set(
        variantEntries
          .map((variant) => normalizeVariantWooId(variant?.id_woo ?? null))
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const dealsByVariantWooId = new Map<string, TimelineBudgetEntry[]>();

    if (variantWooIds.length) {
      type VariantDealRow = {
        deal_id: string | null;
        title: string | null;
        organizations: { name: string | null } | null;
        _count: { alumnos: number } | null;
        w_id_variation: string | number | bigint | null;
      };

      const dealsForVariants = await prisma.deals.findMany({
        where: { w_id_variation: { in: variantWooIds } },
        select: {
          deal_id: true,
          title: true,
          organizations: {
            select: {
              name: true,
            },
          },
          _count: {
            select: {
              alumnos: true,
            },
          },
          w_id_variation: true,
        },
      });

      (dealsForVariants as VariantDealRow[]).forEach((deal) => {
        const variantKey = normalizeVariantWooId(deal?.w_id_variation ?? null);
        if (!variantKey) return;

        const trimmedDealId = typeof deal.deal_id === 'string' ? deal.deal_id.trim() : '';
        const uniqueId = trimmedDealId.length ? `deal-${trimmedDealId}` : `deal-${variantKey}`;
        const studentsCount =
          typeof deal._count?.alumnos === 'number' && Number.isFinite(deal._count.alumnos)
            ? deal._count.alumnos
            : 0;
        const sessionTitle =
          typeof deal.title === 'string' && deal.title.trim().length ? deal.title.trim() : null;
        const companyName =
          typeof deal.organizations?.name === 'string' && deal.organizations.name.trim().length
            ? deal.organizations.name.trim()
            : null;

        const entry: TimelineBudgetEntry = {
          id: uniqueId,
          dealId: trimmedDealId.length ? trimmedDealId : null,
          sessionTitle,
          companyName,
          trainers: [],
          mobileUnits: [],
          type: 'formacionAbierta',
          studentsCount,
        };

        const existing = dealsByVariantWooId.get(variantKey);
        if (existing) {
          existing.push(entry);
        } else {
          dealsByVariantWooId.set(variantKey, [entry]);
        }
      });
    }

    for (const variant of variantEntries) {
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
        const variantWooId = normalizeVariantWooId(variant.id_woo ?? null);
        if (variantWooId) {
          const dealsForVariant = dealsByVariantWooId.get(variantWooId);
          if (dealsForVariant && dealsForVariant.length) {
            entry.budgets.push(...dealsForVariant.map((deal) => ({ ...deal })));
          }
        }
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
        budgets: values.budgets,
      }),
    );

    return successResponse({
      sessions: {
        sinAgendar: unplannedSessions,
        sinFormador: sessionsWithoutTrainer,
        formacionAbiertaSinFormador: variantsWithoutTrainerWithDeals,
        borrador: draftBudgets,
        suspendida: suspendedBudgets,
        porFinalizar: pendingCompletionBudgets,
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

