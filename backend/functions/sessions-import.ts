// backend/functions/sessions-import.ts
import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { createHttpHandler } from './_shared/http';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import { requireAuth } from './_shared/auth';
import { reindexSessionNames } from './_shared/sessionGeneration';

type SessionEstado = 'BORRADOR' | 'PLANIFICADA' | 'SUSPENDIDA' | 'CANCELADA' | 'FINALIZADA';

type ImportRow = {
  deal_id?: unknown;
  deal_product_id?: unknown;
  fecha_inicio_utc?: unknown;
  fecha_fin_utc?: unknown;
  trainer_id?: unknown;
  estado?: unknown;
};

type ImportResult = {
  index: number;
  deal_id: string | null;
  deal_product_id: string | null;
  session_id?: string;
  status: 'success' | 'error';
  message: string;
};

const DEFAULT_UNIT_ID = '52377f13-05dd-4830-88aa-0f5c78bee750';

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const message = (error as any).message;
    if (typeof message === 'string' && message.trim()) return message;

    const body = (error as any).body;
    if (typeof body === 'string') {
      try {
        const parsed = JSON.parse(body);
        if (parsed?.message && typeof parsed.message === 'string') {
          return parsed.message;
        }
      } catch (parseError) {
        console.error('[sessions-import] Failed to parse error body', { error, parseError });
      }
    }
  }

  return 'No se pudo crear la sesión';
}

function toTrimmed(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function toSessionEstado(value: unknown): SessionEstado | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toUpperCase();
  if (!normalized.length) return null;
  return ['BORRADOR', 'PLANIFICADA', 'SUSPENDIDA', 'CANCELADA', 'FINALIZADA'].includes(normalized)
    ? (normalized as SessionEstado)
    : null;
}

function parseDateInput(value: unknown): Date | null | { error: ReturnType<typeof errorResponse> } {
  if (value === undefined) return null;
  if (value === null || value === '') return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const text = String(value).trim();
  if (!text.length) return null;
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) {
    return { error: errorResponse('VALIDATION_ERROR', 'Fecha inválida', 400) };
  }
  return parsed;
}

function ensureValidDateRange(start?: Date | null, end?: Date | null) {
  if (start && end && end.getTime() < start.getTime()) {
    return errorResponse('VALIDATION_ERROR', 'La fecha de fin no puede ser anterior al inicio', 400);
  }
  return null;
}

function normalizeSedeLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  return trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function computeAutomaticSessionEstadoFromValues(args: {
  fechaInicio: Date | null | undefined;
  fechaFin: Date | null | undefined;
  salaId: string | null | undefined;
  trainerIds: string[];
  unidadIds: string[];
  dealSede?: string | null;
}): SessionEstado {
  const { fechaInicio, fechaFin, salaId, trainerIds, unidadIds, dealSede } = args;
  const normalizedSede = normalizeSedeLabel(dealSede);
  const hasValidDates = Boolean(fechaInicio && fechaFin);
  const requiresRoom = normalizedSede !== 'In Company';
  if (requiresRoom && (!salaId || !String(salaId).trim().length)) return 'BORRADOR';
  if (!trainerIds || !trainerIds.length) return 'BORRADOR';
  if (!unidadIds || !unidadIds.length) return 'BORRADOR';
  if (hasValidDates) return 'PLANIFICADA';
  return 'BORRADOR';
}

function buildNombreBase(name?: string | null, code?: string | null): string {
  const fallback = 'Sesión';
  const raw = toTrimmed(name) ?? toTrimmed(code);
  return raw ?? fallback;
}

function pickRandom<T>(items: readonly T[]): T | null {
  if (!items.length) return null;
  const idx = Math.floor(Math.random() * items.length);
  return items[idx] ?? null;
}

async function ensureResourcesAvailable(
  tx: Prisma.TransactionClient,
  args: { trainerIds?: string[]; unidadIds?: string[]; salaId?: string | null; start?: Date | null; end?: Date | null },
) {
  const { trainerIds, unidadIds, salaId, start, end } = args;
  if (!start || !end) return;

  const conditions: any[] = [];
  if (trainerIds && trainerIds.length) {
    conditions.push({ sesion_trainers: { some: { trainer_id: { in: trainerIds } } } });
  }
  if (unidadIds && unidadIds.length) {
    conditions.push({ sesion_unidades: { some: { unidad_movil_id: { in: unidadIds } } } });
  }
  if (salaId) {
    conditions.push({ sala_id: salaId });
  }
  if (!conditions.length) return;

  const overlapping = await tx.sesiones.findFirst({
    where: {
      OR: conditions,
      AND: [
        { fecha_inicio_utc: { lte: end } },
        { fecha_fin_utc: { gte: start } },
      ],
    },
    select: { id: true },
  });

  if (overlapping) {
    throw errorResponse('RESOURCE_UNAVAILABLE', 'Alguno de los recursos ya está ocupado en ese rango de fechas.', 409);
  }
}

function normalizeRow(row: ImportRow, index: number) {
  const dealId = toTrimmed(row.deal_id);
  const dealProductId = toTrimmed(row.deal_product_id);
  const trainerId = toTrimmed(row.trainer_id);
  const estado = toSessionEstado(row.estado);

  if (!dealId || !dealProductId) {
    return { error: errorResponse('VALIDATION_ERROR', `Fila ${index + 1}: deal_id y deal_product_id son obligatorios`, 400) };
  }

  const startResult = parseDateInput(row.fecha_inicio_utc);
  if (startResult && 'error' in startResult) return { error: startResult.error };
  const endResult = parseDateInput(row.fecha_fin_utc);
  if (endResult && 'error' in endResult) return { error: endResult.error };

  const start = startResult as Date | null;
  const end = endResult as Date | null;
  const rangeError = ensureValidDateRange(start, end);
  if (rangeError) return { error: rangeError };

  return { dealId, dealProductId, trainerId, estado, start, end };
}

function normalizeDealProductId(dealId: string, dealProductId: string): string {
  const dealIdPart = toTrimmed(dealId);
  const productPart = toTrimmed(dealProductId);
  if (!dealIdPart || !productPart) return dealProductId;

  const maybeComposite = productPart.split('_');
  if (maybeComposite.length === 2 && maybeComposite[0] === dealIdPart && maybeComposite[1]) {
    return maybeComposite[1];
  }

  return dealProductId;
}

async function createSessionFromRow(
  tx: Prisma.TransactionClient,
  row: ReturnType<typeof normalizeRow> & { dealId: string; dealProductId: string; start: Date | null; end: Date | null },
  salaId: string | null,
): Promise<{ sessionId: string; nombreCache: string }>
// eslint-disable-next-line brace-style
{
  const normalizedDealProductId = normalizeDealProductId(row.dealId, row.dealProductId);

  const deal = await tx.deals.findUnique({
    where: { deal_id: row.dealId },
    select: { deal_id: true, training_address: true, sede_label: true },
  });
  if (!deal) {
    throw errorResponse('NOT_FOUND', `Presupuesto ${row.dealId} no encontrado`, 404);
  }

  const productSearch = [
    { id: normalizedDealProductId },
    { id: row.dealProductId },
    { code: row.dealProductId },
  ];

  if (normalizedDealProductId !== row.dealProductId) {
    productSearch.push({ code: normalizedDealProductId });
  }

  const product = await tx.deal_products.findFirst({
    where: {
      deal_id: deal.deal_id,
      OR: productSearch,
    },
    select: { id: true, deal_id: true, name: true, code: true },
  });

  if (!product) {
    throw errorResponse('NOT_FOUND', `Producto ${row.dealProductId} no encontrado en el presupuesto`, 404);
  }

  const trainerIds = row.trainerId ? [row.trainerId] : [];
  const unidadIds = [DEFAULT_UNIT_ID];

  await ensureResourcesAvailable(tx, {
    trainerIds,
    unidadIds,
    salaId,
    start: row.start,
    end: row.end,
  });

  const autoEstado = computeAutomaticSessionEstadoFromValues({
    fechaInicio: row.start,
    fechaFin: row.end,
    salaId,
    trainerIds,
    unidadIds,
    dealSede: deal.sede_label ?? null,
  });

  const finalEstado = row.estado ?? autoEstado;
  const baseName = buildNombreBase(product.name, product.code);

  const created = await tx.sesiones.create({
    data: {
      id: randomUUID(),
      deal_id: deal.deal_id,
      deal_product_id: product.id,
      nombre_cache: baseName,
      direccion: deal.training_address ?? '',
      estado: finalEstado,
      sala_id: salaId,
      fecha_inicio_utc: row.start,
      fecha_fin_utc: row.end,
    },
  });

  if (trainerIds.length) {
    await tx.sesion_trainers.createMany({
      data: trainerIds.map((trainerId) => ({ sesion_id: created.id, trainer_id: trainerId })),
    });
  }

  await tx.sesion_unidades.create({
    data: { sesion_id: created.id, unidad_movil_id: DEFAULT_UNIT_ID },
  });

  await reindexSessionNames(tx, product.id, baseName);

  return { sessionId: created.id, nombreCache: baseName };
}

export const handler = createHttpHandler<any>(async (request) => {
  if (request.method === 'OPTIONS') {
    return preflightResponse();
  }

  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma);
  if ('error' in auth) {
    return auth.error;
  }

  const rows = Array.isArray(request.body?.rows) ? (request.body.rows as ImportRow[]) : [];
  if (!rows.length) {
    return errorResponse('VALIDATION_ERROR', 'Debes subir al menos una fila válida', 400);
  }

  const salas = await prisma.salas.findMany({ select: { sala_id: true } });
  const salaPool = salas.map((s) => toTrimmed(s.sala_id)).filter((id): id is string => Boolean(id));

  const results: ImportResult[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const normalized = normalizeRow(rows[index], index);
    if ('error' in normalized) {
      results.push({
        index,
        deal_id: toTrimmed(rows[index]?.deal_id),
        deal_product_id: toTrimmed(rows[index]?.deal_product_id),
        status: 'error',
        message: normalized.error.message ?? 'Fila inválida',
      });
      continue;
    }

    try {
      const salaId = pickRandom(salaPool);
      if (!salaId) {
        throw errorResponse('NOT_FOUND', 'No hay salas disponibles para asignar', 404);
      }

      const { sessionId, nombreCache } = await prisma.$transaction((tx) =>
        createSessionFromRow(
          tx,
          normalized as ReturnType<typeof normalizeRow> & {
            dealId: string;
            dealProductId: string;
            start: Date | null;
            end: Date | null;
          },
          salaId,
        ),
      );

      results.push({
        index,
        deal_id: normalized.dealId,
        deal_product_id: normalized.dealProductId,
        session_id: sessionId,
        status: 'success',
        message: `Sesión "${nombreCache}" creada correctamente`,
      });
    } catch (error: any) {
      const message = extractErrorMessage(error);
      console.error('[sessions-import] Failed to import row', {
        index,
        dealId: normalized.dealId,
        dealProductId: normalized.dealProductId,
        row: rows[index],
        error,
      });
      results.push({
        index,
        deal_id: normalized.dealId,
        deal_product_id: normalized.dealProductId,
        status: 'error',
        message,
      });
    }
  }

  const summary = {
    total: results.length,
    successes: results.filter((r) => r.status === 'success').length,
    errors: results.filter((r) => r.status === 'error').length,
  };

  return successResponse({ results, summary });
});

