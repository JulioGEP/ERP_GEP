// backend/functions/dashboard.ts
import type { Prisma, PrismaClient } from '@prisma/client';
import { createHttpHandler } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { nowInMadridDate, nowInMadridISO } from './_shared/timezone';

const YES_VALUES = ['Si', 'Sí'] as const;

type YesLabelField = 'caes_label' | 'fundae_label' | 'hotel_label' | 'po' | 'transporte';

const FORMACION_ABIERTA_PATTERNS = ['formación abierta', 'formacion abierta'] as const;
const FORMACION_ABIERTA_TEMPLATE_VALUES = ['formacion_abierta', 'formacion-abierta'] as const;

type DealValueField =
  | 'caes_val'
  | 'fundae_val'
  | 'hotel_val'
  | 'po_val'
  | 'transporte_val';

const FOLLOW_UP_FIELDS = [
  { labelField: 'caes_label', valueField: 'caes_val', key: 'caesPorTrabajar' },
  { labelField: 'fundae_label', valueField: 'fundae_val', key: 'fundaePorTrabajar' },
  { labelField: 'hotel_label', valueField: 'hotel_val', key: 'hotelPorTrabajar' },
  { labelField: 'po', valueField: 'po_val', key: 'poPorTrabajar' },
  { labelField: 'transporte', valueField: 'transporte_val', key: 'transportePorTrabajar' },
] as const satisfies readonly {
  labelField: YesLabelField;
  valueField: DealValueField;
  key:
    | 'caesPorTrabajar'
    | 'fundaePorTrabajar'
    | 'hotelPorTrabajar'
    | 'poPorTrabajar'
    | 'transportePorTrabajar';
}[];

type FollowUpKey = (typeof FOLLOW_UP_FIELDS)[number]['key'];
type FollowUpCounts = Record<FollowUpKey, number>;

const followUpDefaultCounts: FollowUpCounts = {
  caesPorTrabajar: 0,
  fundaePorTrabajar: 0,
  hotelPorTrabajar: 0,
  poPorTrabajar: 0,
  transportePorTrabajar: 0,
};

const dealsColumnAvailabilityCache = new Map<DealValueField, boolean>();

async function dealsColumnExists(
  prisma: PrismaClient,
  column: DealValueField,
): Promise<boolean> {
  if (dealsColumnAvailabilityCache.has(column)) {
    return dealsColumnAvailabilityCache.get(column) ?? false;
  }

  try {
    const result = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS(
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'deals'
          AND column_name = ${column}
      ) AS "exists";
    `;

    const exists = Boolean(result[0]?.exists);
    if (!exists) {
      console.warn(
        `[dashboard] deals.${column} column is missing in the database, defaulting counter to 0`,
      );
    }
    dealsColumnAvailabilityCache.set(column, exists);
    return exists;
  } catch (error) {
    console.error(`[dashboard] Failed to verify deals.${column} column`, error);
    dealsColumnAvailabilityCache.set(column, false);
    return false;
  }
}

async function computeFollowUpCounts(prisma: PrismaClient): Promise<FollowUpCounts> {
  const entries = await Promise.all(
    FOLLOW_UP_FIELDS.map(async ({ labelField, valueField, key }) => {
      const columnExists = await dealsColumnExists(prisma, valueField);
      if (!columnExists) {
        return [key, 0] as const;
      }

      const count = await prisma.deals.count({
        where: {
          ...buildYesLabelFilter(labelField),
          [valueField]: false,
        } as Prisma.dealsWhereInput,
      });

      return [key, count] as const;
    }),
  );

  return entries.reduce<FollowUpCounts>((acc, [key, value]) => {
    acc[key] = value;
    return acc;
  }, { ...followUpDefaultCounts });
}

function buildYesLabelFilter(field: YesLabelField): Prisma.dealsWhereInput {
  return {
    OR: YES_VALUES.map((value) => ({
      [field]: { equals: value, mode: 'insensitive' },
    })),
  } as Prisma.dealsWhereInput;
}

function buildFormacionAbiertaProductFilter(): Prisma.productsWhereInput {
  const patternFilters: Prisma.productsWhereInput[] = FORMACION_ABIERTA_PATTERNS.flatMap(
    (pattern) => [
      { category: { contains: pattern, mode: 'insensitive' } },
      { type: { contains: pattern, mode: 'insensitive' } },
      { template: { contains: pattern, mode: 'insensitive' } },
      { name: { contains: pattern, mode: 'insensitive' } },
    ],
  );

  const templateFilters: Prisma.productsWhereInput[] = FORMACION_ABIERTA_TEMPLATE_VALUES.map(
    (value) => ({ template: { equals: value, mode: 'insensitive' } }),
  );

  return {
    OR: patternFilters.concat(templateFilters),
  } satisfies Prisma.productsWhereInput;
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
    const [draftSessions, suspendedSessions, pendingCompletionSessions, openTrainingVariantsWithoutResources] =
      await Promise.all([
        prisma.sesiones.count({ where: { estado: 'BORRADOR' } }),
        prisma.sesiones.count({ where: { estado: 'SUSPENDIDA' } }),
        prisma.sesiones.count({
          where: {
            estado: { not: 'FINALIZADA' },
            fecha_fin_utc: { not: null, lt: now },
          },
        }),
        prisma.variants.count({
          where: {
            AND: [
              { OR: [{ trainer_id: null }, { trainer_id: { equals: '' } }] },
              { OR: [{ sala_id: null }, { sala_id: { equals: '' } }] },
              { products: buildFormacionAbiertaProductFilter() },
            ],
          },
        }),
      ]);

    const followUpCounts = await computeFollowUpCounts(prisma);

    return successResponse({
      sessions: {
        borrador: draftSessions,
        suspendida: suspendedSessions,
        porFinalizar: pendingCompletionSessions,
        formacionAbiertaSinRecursos: openTrainingVariantsWithoutResources,
      },
      followUp: {
        caesPorTrabajar: followUpCounts.caesPorTrabajar,
        fundaePorTrabajar: followUpCounts.fundaePorTrabajar,
        hotelPorTrabajar: followUpCounts.hotelPorTrabajar,
        poPorTrabajar: followUpCounts.poPorTrabajar,
        transportePorTrabajar: followUpCounts.transportePorTrabajar,
      },
      generatedAt: nowInMadridISO(),
    });
  } catch (error) {
    console.error('[dashboard] Failed to compute metrics', error);
    return errorResponse('DASHBOARD_ERROR', 'No se pudieron cargar las métricas del dashboard', 500);
  }
});

