// backend/functions/dashboard.ts
import type { Prisma } from '@prisma/client';
import { createHttpHandler } from './_shared/http';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { nowInMadridDate, nowInMadridISO } from './_shared/timezone';

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
    ]);

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
    });
  } catch (error) {
    console.error('[dashboard] Failed to compute metrics', error);
    return errorResponse('DASHBOARD_ERROR', 'No se pudieron cargar las métricas del dashboard', 500);
  }
});

