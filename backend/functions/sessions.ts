// backend/functions/sessions.ts
import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import { buildMadridDateTime, formatTimeFromDb } from './_shared/time';
import {
  getVariantResourceColumnsSupport,
  isVariantResourceColumnError,
  setVariantResourceColumnsSupport,
} from './_shared/variant-resources';
import {
  generateSessionsForDeal,
  hasApplicableCode,
  hasPrevencionPrefix,
  reindexSessionNames,
  toNonNegativeInt,
} from './_shared/sessionGeneration';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;
type SessionEstado = 'BORRADOR' | 'PLANIFICADA' | 'SUSPENDIDA' | 'CANCELADA' | 'FINALIZADA';

const SESSION_STATE_VALUES: SessionEstado[] = [
  'BORRADOR',
  'PLANIFICADA',
  'SUSPENDIDA',
  'CANCELADA',
  'FINALIZADA',
];
const MANUAL_SESSION_STATES = new Set<SessionEstado>(['SUSPENDIDA', 'CANCELADA', 'FINALIZADA']);
const BORRADOR_TRANSITION_STATES = new Set<SessionEstado>(['SUSPENDIDA', 'CANCELADA']);

type AutomaticSessionEstado = Extract<SessionEstado, 'BORRADOR' | 'PLANIFICADA'>;

// Certain unidades móviles act as placeholders and should never block availability checks.
const ALWAYS_AVAILABLE_UNIT_IDS = new Set(['52377f13-05dd-4830-88aa-0f5c78bee750']);

function toTrimmed(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function toOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return String(value);
}

function parseJson(body: string | null | undefined): any {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function toPositiveInt(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function parseSessionIdFromPath(path: string): string | null {
  const value = String(path || '');
  const match = value.match(/\/(?:\.netlify\/functions\/)?sessions\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function toIsoOrNull(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  try {
    const d = date instanceof Date ? date : new Date(date);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  } catch {
    return null;
  }
}

type SessionRecord = {
  id: string;
  deal_id: string;
  deal_product_id: string;
  nombre_cache: string;
  fecha_inicio_utc: Date | null;
  fecha_fin_utc: Date | null;
  sala_id: string | null;
  direccion: string;
  estado: SessionEstado;
  drive_url: string | null;
  trainers: Array<{ trainer_id: string }>;
  unidades: Array<{ unidad_id: string }>;
  deal?: { sede_label: string | null; pipeline_id: string | null } | null;
};

const SEDE_ALIASES: Record<string, string> = {
  'c/ moratín, 100, 08206 sabadell, barcelona': 'GEP Sabadell',
  'c/ primavera, 1, 28500, arganda del rey, madrid': 'GEP Arganda',
  'in company - unidad móvil': 'In Company',
};

function normalizeSedeLabel(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed.length) return null;
  const alias = SEDE_ALIASES[trimmed.toLowerCase()];
  return alias ?? trimmed;
}

const PIPELINES_ALLOW_PLANIFICADA_WITHOUT_DATES = new Set([
  'gep services',
  'formacion empresas',
  'formacion empresa',
]);

const PIPELINES_ALLOW_PLANIFICADA_WITHOUT_ROOM = new Set(['gep services']);

function normalizePipelineLabel(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed.length) return null;
  return trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function allowsAutomaticPlanificadaWithoutDates(
  pipelineLabel: string | null | undefined,
): boolean {
  const normalized = normalizePipelineLabel(pipelineLabel);
  if (!normalized) return false;
  return PIPELINES_ALLOW_PLANIFICADA_WITHOUT_DATES.has(normalized);
}

function allowsAutomaticPlanificadaWithoutRoom(pipelineLabel: string | null | undefined): boolean {
  const normalized = normalizePipelineLabel(pipelineLabel);
  if (!normalized) return false;
  return PIPELINES_ALLOW_PLANIFICADA_WITHOUT_ROOM.has(normalized);
}

function toSessionEstado(value: unknown): SessionEstado | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toUpperCase();
  if (!normalized.length) return null;
  return SESSION_STATE_VALUES.includes(normalized as SessionEstado)
    ? (normalized as SessionEstado)
    : null;
}

function isManualSessionEstado(value: SessionEstado | null | undefined): boolean {
  return value ? MANUAL_SESSION_STATES.has(value) : false;
}

function isBorradorTransitionEstado(value: SessionEstado | null | undefined): boolean {
  return value ? BORRADOR_TRANSITION_STATES.has(value) : false;
}

function computeAutomaticSessionEstadoFromValues({
  fechaInicio,
  fechaFin,
  salaId,
  trainerIds,
  unidadIds,
  dealSede,
  dealPipeline,
}: {
  fechaInicio: Date | null | undefined;
  fechaFin: Date | null | undefined;
  salaId: string | null | undefined;
  trainerIds: string[];
  unidadIds: string[];
  dealSede?: string | null;
  dealPipeline?: string | null;
}): AutomaticSessionEstado {
  const allowWithoutDates = allowsAutomaticPlanificadaWithoutDates(dealPipeline);
  const allowWithoutRoom = allowsAutomaticPlanificadaWithoutRoom(dealPipeline);
  const hasValidDates = Boolean(fechaInicio && fechaFin);
  const normalizedSede = normalizeSedeLabel(dealSede);
  const requiresRoom = !allowWithoutRoom && normalizedSede !== 'In Company';
  if (
    requiresRoom &&
    (!salaId || !String(salaId).trim().length)
  ) {
    return 'BORRADOR';
  }
  if (!trainerIds || !trainerIds.length) return 'BORRADOR';
  if (!unidadIds || !unidadIds.length) return 'BORRADOR';
  if (hasValidDates || allowWithoutDates) {
    return 'PLANIFICADA';
  }
  return 'BORRADOR';
}

function resolveAutomaticSessionEstado(row: SessionRecord): AutomaticSessionEstado {
  const trainerIds = row.trainers.map((trainer) => trainer.trainer_id).filter(Boolean);
  const unidadIds = row.unidades.map((unidad) => unidad.unidad_id).filter(Boolean);
  return computeAutomaticSessionEstadoFromValues({
    fechaInicio: row.fecha_inicio_utc,
    fechaFin: row.fecha_fin_utc,
    salaId: row.sala_id,
    trainerIds,
    unidadIds,
    dealSede: row.deal?.sede_label ?? null,
    dealPipeline: row.deal?.pipeline_id ?? null,
  });
}

function resolveSessionEstado(row: SessionRecord): SessionEstado {
  if (isManualSessionEstado(row.estado)) {
    return row.estado;
  }
  return resolveAutomaticSessionEstado(row);
}

async function applyAutomaticSessionState(
  tx: Prisma.TransactionClient,
  sessions: SessionRecord[],
): Promise<void> {
  const updates: Promise<unknown>[] = [];

  sessions.forEach((session) => {
    if (isManualSessionEstado(session.estado)) {
      return;
    }
    const autoEstado = resolveAutomaticSessionEstado(session);
    if (session.estado !== autoEstado) {
      session.estado = autoEstado;
      updates.push(
        tx.sessions.update({
          where: { id: session.id },
          data: { estado: autoEstado } as any,
        }),
      );
    } else {
      session.estado = autoEstado;
    }
  });

  if (updates.length) {
    await Promise.all(updates);
  }
}

function normalizeSession(row: SessionRecord) {
  const trainerIds = row.trainers.map((trainer) => trainer.trainer_id);
  const unidadIds = row.unidades.map((unidad) => unidad.unidad_id);
  const estado = resolveSessionEstado(row);

  return {
    id: row.id,
    deal_id: row.deal_id,
    deal_product_id: row.deal_product_id,
    nombre_cache: row.nombre_cache,
    fecha_inicio_utc: toIsoOrNull(row.fecha_inicio_utc),
    fecha_fin_utc: toIsoOrNull(row.fecha_fin_utc),
    sala_id: row.sala_id,
    direccion: row.direccion,
    estado,
    drive_url: toTrimmed(row.drive_url),
    trainer_ids: trainerIds,
    unidad_movil_ids: unidadIds,
  };
}

function buildNombreBase(name?: string | null, code?: string | null): string {
  const fallback = 'Sesión';
  const raw = toTrimmed(name) ?? toTrimmed(code);
  return raw ?? fallback;
}


function parseDateInput(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  const text = String(value).trim();
  if (!text.length) return null;
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) {
    return { error: errorResponse('VALIDATION_ERROR', 'Fecha inválida', 400) };
  }
  return parsed;
}

function ensureArrayOfStrings(value: unknown): string[] | { error: ReturnType<typeof errorResponse> } {
  if (value === undefined) return [];
  if (value === null) return [];
  if (!Array.isArray(value)) {
    return { error: errorResponse('VALIDATION_ERROR', 'El campo debe ser un array de strings', 400) };
  }
  const items: string[] = [];
  for (const entry of value) {
    const trimmed = toTrimmed(entry);
    if (!trimmed) continue;
    if (!items.includes(trimmed)) items.push(trimmed);
  }
  return items;
}

type SessionPatchResult =
  | {
      data: Prisma.sessionsUpdateInput;
      trainerIds?: string[];
      unidadIds?: string[];
      estado?: SessionEstado;
    }
  | { error: ReturnType<typeof errorResponse> };

function buildSessionPatch(body: any): SessionPatchResult {
  if (!body || typeof body !== 'object') {
    return { error: errorResponse('VALIDATION_ERROR', 'Body inválido', 400) };
  }

  const data: Prisma.sessionsUpdateInput & Record<string, any> = {};

  if (Object.prototype.hasOwnProperty.call(body, 'fecha_inicio_utc')) {
    const parsed = parseDateInput(body.fecha_inicio_utc);
    if (parsed && 'error' in parsed) return { error: parsed.error };
    data.fecha_inicio_utc = parsed === undefined ? undefined : (parsed as Date | null);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'fecha_fin_utc')) {
    const parsed = parseDateInput(body.fecha_fin_utc);
    if (parsed && 'error' in parsed) return { error: parsed.error };
    data.fecha_fin_utc = parsed === undefined ? undefined : (parsed as Date | null);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'sala_id')) {
    const value = body.sala_id === null ? null : toTrimmed(body.sala_id);
    data.sala_id = value ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'direccion')) {
    const value = toOptionalText(body.direccion);
    if (value == null) {
      return { error: errorResponse('VALIDATION_ERROR', 'La dirección es obligatoria', 400) };
    }
    data.direccion = value;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'nombre_cache')) {
    const value = toOptionalText(body.nombre_cache);
    data.nombre_cache = value ?? 'Sesión';
  }

  let trainerIds: string[] | undefined;
  if (Object.prototype.hasOwnProperty.call(body, 'trainer_ids')) {
    const trainerIdsResult = ensureArrayOfStrings(body.trainer_ids);
    if (trainerIdsResult && 'error' in trainerIdsResult) {
      return { error: trainerIdsResult.error };
    }
    trainerIds = trainerIdsResult;
  }

  let unidadIds: string[] | undefined;
  if (Object.prototype.hasOwnProperty.call(body, 'unidad_movil_ids')) {
    const unidadIdsResult = ensureArrayOfStrings(body.unidad_movil_ids);
    if (unidadIdsResult && 'error' in unidadIdsResult) {
      return { error: unidadIdsResult.error };
    }
    unidadIds = unidadIdsResult;
  }

  let estado: SessionEstado | undefined;
  if (Object.prototype.hasOwnProperty.call(body, 'estado')) {
    const parsedEstado = toSessionEstado(body.estado);
    if (!parsedEstado) {
      return { error: errorResponse('VALIDATION_ERROR', 'Estado inválido', 400) };
    }
    estado = parsedEstado;
  }

  return { data, trainerIds, unidadIds, estado };
}

function ensureValidDateRange(start?: Date | null, end?: Date | null) {
  if (start && end && end.getTime() < start.getTime()) {
    return errorResponse('VALIDATION_ERROR', 'La fecha de fin no puede ser anterior al inicio', 400);
  }
  return null;
}

type DateRange = { start: Date; end: Date };

function normalizeDateRange(
  start: Date | null | undefined,
  end: Date | null | undefined,
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

type VariantTimeParts = { hour: number; minute: number };

function extractVariantTimeParts(value: Date | string | null | undefined): VariantTimeParts | null {
  const formatted = formatTimeFromDb(value);
  if (!formatted) return null;
  const match = formatted.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function buildVariantDateTime(
  date: Date,
  time: VariantTimeParts | null,
  fallback: VariantTimeParts,
): Date {
  const parts = time ?? fallback;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return buildMadridDateTime({ year, month, day, hour: parts.hour, minute: parts.minute });
}

function computeVariantRange(
  variantDate: Date | string | null | undefined,
  productTimes: { hora_inicio: Date | string | null; hora_fin: Date | string | null },
): DateRange | null {
  if (!variantDate) {
    return null;
  }

  const parsedDate = new Date(variantDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const startTime = extractVariantTimeParts(productTimes.hora_inicio);
  const endTime = extractVariantTimeParts(productTimes.hora_fin);
  const fallbackStart: VariantTimeParts = startTime ?? { hour: 9, minute: 0 };
  const fallbackEnd: VariantTimeParts = endTime ?? (startTime ? { ...startTime } : { hour: 11, minute: 0 });

  const start = buildVariantDateTime(parsedDate, startTime, fallbackStart);
  let end = buildVariantDateTime(parsedDate, endTime, fallbackEnd);

  if (end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }

  return { start, end };
}

async function ensureResourcesAvailable(
  tx: Prisma.TransactionClient,
  {
    sessionId,
    trainerIds,
    unidadIds,
    salaId,
    start,
    end,
  }: {
    sessionId?: string;
    trainerIds?: string[];
    unidadIds?: string[];
    salaId?: string | null;
    start?: Date | null;
    end?: Date | null;
  },
) {
  const range = normalizeDateRange(start ?? null, end ?? null);
  if (!range) return;

  const resourceConditions: Prisma.sessionsWhereInput[] = [];

  if (trainerIds && trainerIds.length) {
    resourceConditions.push({ trainers: { some: { trainer_id: { in: trainerIds } } } });
  }

  const filteredUnidadIds = (unidadIds ?? []).filter((unidadId) =>
    unidadId ? !ALWAYS_AVAILABLE_UNIT_IDS.has(unidadId) : false,
  );

  if (filteredUnidadIds.length) {
    resourceConditions.push({ unidades: { some: { unidad_id: { in: filteredUnidadIds } } } });
  }

  if (salaId) {
    resourceConditions.push({ sala_id: salaId });
  }

  if (!resourceConditions.length) return;

  const sessions = await tx.sessions.findMany({
    where: {
      ...(sessionId ? { id: { not: sessionId } } : {}),
      OR: resourceConditions,
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

  const conflicting = sessions.filter((session) => {
    const sessionRange = normalizeDateRange(session.fecha_inicio_utc, session.fecha_fin_utc);
    if (!sessionRange) return false;
    return (
      sessionRange.start.getTime() <= range.end.getTime() &&
      sessionRange.end.getTime() >= range.start.getTime()
    );
  });

  if (!conflicting.length) return;

  throw errorResponse(
    'RESOURCE_UNAVAILABLE',
    'Algunos recursos ya están asignados en las fechas seleccionadas.',
    409,
  );
}

function parseLimit(value: unknown): number {
  const parsed = toPositiveInt(value, DEFAULT_LIMIT);
  return Math.min(parsed || DEFAULT_LIMIT, MAX_LIMIT);
}

async function fetchSessionsByProduct(
  prisma: Prisma.TransactionClient,
  dealId: string,
  productId: string,
  page: number,
  limit: number,
) {
  const [total, rows] = await Promise.all([
    prisma.sessions.count({ where: { deal_id: dealId, deal_product_id: productId } }),
    prisma.sessions.findMany({
      where: { deal_id: dealId, deal_product_id: productId },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        trainers: { select: { trainer_id: true } },
        unidades: { select: { unidad_id: true } },
        deal: { select: { sede_label: true, pipeline_id: true } },
      },
    }),
  ]);

  await applyAutomaticSessionState(prisma, rows as unknown as SessionRecord[]);

  return { total, rows };
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    const prisma = getPrisma();
    const method = event.httpMethod;
    const path = event.path || '';
    const isAvailabilityRequest =
      /\/(?:\.netlify\/functions\/)?sessions\/availability$/i.test(path);
    const isRangeRequest = /\/(?:\.netlify\/functions\/)?sessions\/range$/i.test(path);
    const isDealSessionsRequest =
      /\/(?:\.netlify\/functions\/)?sessions\/by-deal$/i.test(path);
    const isCountsRequest =
      /\/(?:\.netlify\/functions\/)?sessions\/[^/]+\/counts$/i.test(path);
    const sessionIdFromPath =
      isAvailabilityRequest || isDealSessionsRequest ? null : parseSessionIdFromPath(path);

    if (method === 'POST' && /\/sessions\/generate-from-deal$/i.test(path)) {
      const body = parseJson(event.body);
      const dealId = toTrimmed(body?.dealId);
      if (!dealId) {
        return errorResponse('VALIDATION_ERROR', 'dealId es obligatorio', 400);
      }

      const result = await prisma.$transaction((tx) => generateSessionsForDeal(tx, dealId));
      if ('error' in result) return result.error;
      return successResponse({ count: result.count ?? 0 });
    }

    if (method === 'GET' && isAvailabilityRequest) {
      const startParam = toTrimmed(event.queryStringParameters?.start);
      if (!startParam) {
        return errorResponse('VALIDATION_ERROR', 'El parámetro start es obligatorio', 400);
      }

      const startResult = parseDateInput(startParam);
      if (startResult && 'error' in startResult) return startResult.error;
      const startDate = startResult as Date | null | undefined;
      if (!startDate) {
        return errorResponse('VALIDATION_ERROR', 'El parámetro start es inválido', 400);
      }

      const endParam = toTrimmed(event.queryStringParameters?.end);
      const endResult = endParam === null ? null : parseDateInput(endParam ?? undefined);
      if (endResult && typeof endResult === 'object' && 'error' in endResult) {
        return endResult.error;
      }

      const endDate =
        endResult === undefined ? null : ((endResult as Date | null | undefined) ?? null);
      const range = normalizeDateRange(startDate, endDate ?? startDate);
      if (!range) {
        return errorResponse('VALIDATION_ERROR', 'Rango de fechas inválido', 400);
      }

      const excludeSessionId = toTrimmed(event.queryStringParameters?.excludeSessionId);
      const excludeVariantId = toTrimmed(event.queryStringParameters?.excludeVariantId);

      const sessions = await prisma.sessions.findMany({
        where: {
          ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
          OR: [
            { sala_id: { not: null } },
            { trainers: { some: {} } },
            { unidades: { some: {} } },
          ],
        },
        select: {
          id: true,
          sala_id: true,
          fecha_inicio_utc: true,
          fecha_fin_utc: true,
          trainers: { select: { trainer_id: true } },
          unidades: { select: { unidad_id: true } },
        },
      });

      const trainerLocks = new Set<string>();
      const roomLocks = new Set<string>();
      const unitLocks = new Set<string>();

      sessions.forEach((session) => {
        const sessionRange = normalizeDateRange(session.fecha_inicio_utc, session.fecha_fin_utc);
        if (!sessionRange) return;
        if (
          sessionRange.start.getTime() <= range.end.getTime() &&
          sessionRange.end.getTime() >= range.start.getTime()
        ) {
          session.trainers.forEach((trainer) => trainerLocks.add(trainer.trainer_id));
          session.unidades.forEach((unit) => unitLocks.add(unit.unidad_id));
          if (session.sala_id) roomLocks.add(session.sala_id);
        }
      });

      if (getVariantResourceColumnsSupport() !== false) {
        try {
          const variantQueryArgs = {
            where: {
              ...(excludeVariantId ? { id: { not: excludeVariantId } } : {}),
              date: { not: null },
              OR: [
                { trainer_id: { not: null } },
                { sala_id: { not: null } },
                { unidad_movil_id: { not: null } },
              ],
            },
            select: {
              id: true,
              date: true,
              trainer_id: true,
              sala_id: true,
              unidad_movil_id: true,
              product: { select: { hora_inicio: true, hora_fin: true } },
            },
          } as const;

          const variants = await prisma.variants.findMany(variantQueryArgs as any);

          setVariantResourceColumnsSupport(true);

          variants.forEach((variant) => {
            const variantRange = computeVariantRange(variant.date, variant.product ?? { hora_inicio: null, hora_fin: null });
            if (!variantRange) return;
            if (
              variantRange.start.getTime() <= range.end.getTime() &&
              variantRange.end.getTime() >= range.start.getTime()
            ) {
              if (variant.trainer_id) trainerLocks.add(variant.trainer_id);
              if (variant.sala_id) roomLocks.add(variant.sala_id);
              if (variant.unidad_movil_id && !ALWAYS_AVAILABLE_UNIT_IDS.has(variant.unidad_movil_id)) {
                unitLocks.add(variant.unidad_movil_id);
              }
            }
          });
        } catch (error) {
          if (isVariantResourceColumnError(error)) {
            setVariantResourceColumnsSupport(false);
            console.warn(
              '[sessions] skipping variant resource availability check (missing resource columns)',
              { error },
            );
          } else {
            throw error;
          }
        }
      }

      return successResponse({
        availability: {
          trainers: Array.from(trainerLocks),
          rooms: Array.from(roomLocks),
          units: Array.from(unitLocks),
        },
      });
    }

    if (method === 'GET' && isDealSessionsRequest) {
      const dealId = toTrimmed(event.queryStringParameters?.dealId);
      if (!dealId) {
        return errorResponse('VALIDATION_ERROR', 'dealId es obligatorio', 400);
      }

      const sessions = await prisma.sessions.findMany({
        where: { deal_id: dealId },
        orderBy: [
          { fecha_inicio_utc: 'asc' },
          { created_at: 'asc' },
        ],
        select: {
          id: true,
          fecha_inicio_utc: true,
          fecha_fin_utc: true,
          sala: { select: { sala_id: true, name: true } },
        },
      });

      const payload = sessions.map((session) => ({
        id: session.id,
        fecha_inicio_utc: toIsoOrNull(session.fecha_inicio_utc),
        fecha_fin_utc: toIsoOrNull(session.fecha_fin_utc),
        room: session.sala
          ? {
              id: session.sala.sala_id,
              name: session.sala.name,
            }
          : null,
      }));

      return successResponse({ sessions: payload });
    }

    if (method === 'GET' && isRangeRequest) {
      const startParam = toTrimmed(event.queryStringParameters?.start);
      if (!startParam) {
        return errorResponse('VALIDATION_ERROR', 'El parámetro start es obligatorio', 400);
      }

      const startResult = parseDateInput(startParam);
      if (startResult && 'error' in startResult) return startResult.error;
      const startDate = startResult as Date | null | undefined;
      if (!startDate) {
        return errorResponse('VALIDATION_ERROR', 'El parámetro start es inválido', 400);
      }

      const endParam = toTrimmed(event.queryStringParameters?.end);
      const endResult = endParam === null ? null : parseDateInput(endParam ?? undefined);
      if (endResult && typeof endResult === 'object' && 'error' in endResult) {
        return endResult.error;
      }
      const endDate = endResult === undefined ? null : ((endResult as Date | null | undefined) ?? null);

      const range = normalizeDateRange(startDate, endDate ?? startDate);
      if (!range) {
        return errorResponse('VALIDATION_ERROR', 'Rango de fechas inválido', 400);
      }

      const maxRangeMs = 120 * 24 * 60 * 60 * 1000; // 120 días
      if (range.end.getTime() - range.start.getTime() > maxRangeMs) {
        return errorResponse('VALIDATION_ERROR', 'El rango máximo permitido es de 120 días', 400);
      }

      const dealFilter = toTrimmed(event.queryStringParameters?.dealId);
      const productFilter = toTrimmed(event.queryStringParameters?.productId);
      const salaFilter = toTrimmed(event.queryStringParameters?.roomId);
      const trainerFilter = toTrimmed(event.queryStringParameters?.trainerId);
      const unidadFilter = toTrimmed(event.queryStringParameters?.unitId);
      const estadoParam = toTrimmed(event.queryStringParameters?.estado);

      let estadoFilters: SessionEstado[] | null = null;
      if (estadoParam) {
        const values = estadoParam
          .split(',')
          .map((value) => toSessionEstado(value))
          .filter((value): value is SessionEstado => !!value);
        estadoFilters = values.length ? values : null;
      }

      const sessions = await prisma.sessions.findMany({
        where: {
          fecha_inicio_utc: { not: null },
          fecha_fin_utc: { not: null },
          ...(dealFilter ? { deal_id: dealFilter } : {}),
          ...(productFilter ? { deal_product_id: productFilter } : {}),
          ...(salaFilter ? { sala_id: salaFilter } : {}),
          ...(trainerFilter ? { trainers: { some: { trainer_id: trainerFilter } } } : {}),
          ...(unidadFilter ? { unidades: { some: { unidad_id: unidadFilter } } } : {}),
          ...(estadoFilters
            ? estadoFilters.length === 1
              ? { estado: estadoFilters[0] }
              : { estado: { in: estadoFilters } }
            : {}),
          AND: [
            {
              OR: [
                { fecha_inicio_utc: { gte: range.start, lte: range.end } },
                { fecha_fin_utc: { gte: range.start, lte: range.end } },
                {
                  AND: [
                    { fecha_inicio_utc: { lte: range.start } },
                    { fecha_fin_utc: { gte: range.end } },
                  ],
                },
              ],
            },
          ],
        },
        include: {
          deal: {
            select: {
              deal_id: true,
              title: true,
              training_address: true,
              pipeline_id: true,
              sede_label: true,
              caes_label: true,
              fundae_label: true,
              hotel_label: true,
              transporte: true,
            },
          },
          deal_product: { select: { id: true, name: true, code: true } },
          sala: { select: { sala_id: true, name: true, sede: true } },
          trainers: {
            select: {
              trainer_id: true,
              trainer: { select: { trainer_id: true, name: true, apellido: true } },
            },
          },
          unidades: {
            select: {
              unidad_id: true,
              unidad: { select: { unidad_id: true, name: true, matricula: true } },
            },
          },
        },
        orderBy: [
          { fecha_inicio_utc: 'asc' },
          { nombre_cache: 'asc' },
        ],
      });

      const rowsById = new Map(sessions.map((row) => [row.id, row]));

      const payload = sessions
        .map((session) => normalizeSession(session as unknown as SessionRecord))
        .filter((session) => session.fecha_inicio_utc && session.fecha_fin_utc)
        .map((session) => {
          const raw = rowsById.get(session.id);
          const sala = raw?.sala
            ? {
                sala_id: raw.sala.sala_id,
                name: raw.sala.name,
                sede: raw.sala.sede ?? null,
              }
            : null;
          const trainers = (raw?.trainers ?? [])
            .map((link) =>
              link.trainer
                ? {
                    trainer_id: link.trainer.trainer_id,
                    name: link.trainer.name,
                    apellido: link.trainer.apellido ?? null,
                  }
                : null,
            )
            .filter((value): value is { trainer_id: string; name: string; apellido: string | null } => !!value);
          const unidades = (raw?.unidades ?? [])
            .map((link) =>
              link.unidad
                ? {
                    unidad_id: link.unidad.unidad_id,
                    name: link.unidad.name,
                    matricula: link.unidad.matricula ?? null,
                  }
                : null,
            )
            .filter((value): value is NonNullable<typeof value> => value != null);

          return {
            id: session.id,
            deal_id: session.deal_id,
            deal_title: raw?.deal?.title ?? null,
            deal_training_address: raw?.deal?.training_address ?? null,
            deal_sede_label: raw?.deal?.sede_label ?? null,
            deal_product_id: session.deal_product_id,
            product_name: raw?.deal_product?.name ?? null,
            product_code: raw?.deal_product?.code ?? null,
            nombre_cache: session.nombre_cache,
            fecha_inicio_utc: session.fecha_inicio_utc,
            fecha_fin_utc: session.fecha_fin_utc,
            direccion: session.direccion,
            estado: session.estado,
            deal_pipeline_id: raw?.deal?.pipeline_id ?? null,
            deal_caes_label: raw?.deal?.caes_label ?? null,
            deal_fundae_label: raw?.deal?.fundae_label ?? null,
            deal_hotel_label: raw?.deal?.hotel_label ?? null,
            deal_transporte: raw?.deal?.transporte ?? null,
            sala,
            trainers,
            unidades,
          };
        });

      return successResponse({
        range: {
          start: range.start.toISOString(),
          end: range.end.toISOString(),
        },
        sessions: payload,
      });
    }

    if (method === 'GET' && isCountsRequest && sessionIdFromPath) {
      const existing = await prisma.sessions.findUnique({
        where: { id: sessionIdFromPath },
        select: { id: true },
      });

      if (!existing) {
        return errorResponse('NOT_FOUND', 'Sesión no encontrada', 404);
      }

      const [comentarios, documentos, alumnos, tokens] = await prisma.$transaction([
        prisma.sesiones_comentarios.count({ where: { sesion_id: sessionIdFromPath } }),
        prisma.session_files.count({ where: { sesion_id: sessionIdFromPath } }),
        prisma.alumnos.count({ where: { sesion_id: sessionIdFromPath } }),
        prisma.tokens.count({ where: { sesion_id: sessionIdFromPath, active: true } }),
      ]);

      return successResponse({ comentarios, documentos, alumnos, tokens });
    }

    if (method === 'GET') {
      const dealId = toTrimmed(event.queryStringParameters?.dealId);
      if (!dealId) {
        return errorResponse('VALIDATION_ERROR', 'dealId es obligatorio', 400);
      }

      const productIdParam = toTrimmed(event.queryStringParameters?.productId);
      const page = Math.max(1, toPositiveInt(event.queryStringParameters?.page, 1));
      const limit = parseLimit(event.queryStringParameters?.limit);

      const response = await prisma.$transaction(async (tx) => {
        const deal = await tx.deals.findUnique({
          where: { deal_id: dealId },
          select: {
            deal_id: true,
            deal_products: {
              select: { id: true, code: true, name: true, quantity: true },
              orderBy: [{ created_at: 'asc' }],
            },
          },
        });

        if (!deal) {
          throw errorResponse('NOT_FOUND', 'Presupuesto no encontrado', 404);
        }

        const products = (deal.deal_products ?? []).filter((product) =>
          hasApplicableCode(product.code),
        );

        const filteredProducts = productIdParam
          ? products.filter((product) => product.id === productIdParam)
          : products;

        const payload = await Promise.all(
          filteredProducts.map(async (product) => {
            const { total, rows } = await fetchSessionsByProduct(tx, deal.deal_id, product.id, page, limit);
            const mapped = rows.map((row) =>
              normalizeSession(row as unknown as SessionRecord),
            );
            return {
              product: {
                id: product.id,
                code: product.code,
                name: product.name,
                quantity: toNonNegativeInt(product.quantity, 0),
              },
              sessions: mapped,
              pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
              },
            };
          }),
        );

        return payload;
      });

      return successResponse({ groups: response });
    }

    if (method === 'POST' && !sessionIdFromPath) {
      const body = parseJson(event.body);
      const dealId = toTrimmed(body?.deal_id);
      const dealProductId = toTrimmed(body?.deal_product_id);
      if (!dealId || !dealProductId) {
        return errorResponse('VALIDATION_ERROR', 'deal_id y deal_product_id son obligatorios', 400);
      }

      const trainerIdsResult = ensureArrayOfStrings(body.trainer_ids);
      if (trainerIdsResult && 'error' in trainerIdsResult) return trainerIdsResult.error;

      const unidadIdsResult = ensureArrayOfStrings(body.unidad_movil_ids);
      if (unidadIdsResult && 'error' in unidadIdsResult) return unidadIdsResult.error;

      const fechaInicioResult = parseDateInput(body.fecha_inicio_utc);
      if (fechaInicioResult && 'error' in fechaInicioResult) return fechaInicioResult.error;

      const fechaFinResult = parseDateInput(body.fecha_fin_utc);
      if (fechaFinResult && 'error' in fechaFinResult) return fechaFinResult.error;

      const rangeError = ensureValidDateRange(
        (fechaInicioResult as Date | null | undefined) ?? undefined,
        (fechaFinResult as Date | null | undefined) ?? undefined,
      );
      if (rangeError) return rangeError;

      const direccion = toOptionalText(body.direccion);
      const fechaInicioDate =
        fechaInicioResult === undefined ? null : (fechaInicioResult as Date | null);
      const fechaFinDate =
        fechaFinResult === undefined ? null : (fechaFinResult as Date | null);
      const salaId = toTrimmed(body.sala_id);

      const result = await prisma.$transaction(async (tx) => {
        const deal = await tx.deals.findUnique({
          where: { deal_id: dealId },
          select: { deal_id: true, training_address: true, sede_label: true, pipeline_id: true },
        });
        if (!deal) {
          throw errorResponse('NOT_FOUND', 'Presupuesto no encontrado', 404);
        }

        const product = await tx.deal_products.findUnique({
          where: { id: dealProductId },
          select: { id: true, deal_id: true, name: true, code: true },
        });
        if (!product || product.deal_id !== deal.deal_id) {
          throw errorResponse('NOT_FOUND', 'Producto del presupuesto no encontrado', 404);
        }

        const baseName = buildNombreBase(product.name, product.code);

        await ensureResourcesAvailable(tx, {
          trainerIds: trainerIdsResult.length ? trainerIdsResult : undefined,
          unidadIds: unidadIdsResult.length ? unidadIdsResult : undefined,
          salaId: salaId ?? null,
          start: fechaInicioDate,
          end: fechaFinDate,
        });

        const autoEstado = computeAutomaticSessionEstadoFromValues({
          fechaInicio: fechaInicioDate,
          fechaFin: fechaFinDate,
          salaId: salaId ?? null,
          trainerIds: trainerIdsResult,
          unidadIds: unidadIdsResult,
          dealSede: deal.sede_label ?? null,
          dealPipeline: deal.pipeline_id ?? null,
        });

        const created = await tx.sessions.create({
          data: {
            id: randomUUID(),
            deal_id: deal.deal_id,
            deal_product_id: product.id,
            nombre_cache: baseName,
            direccion: direccion ?? deal.training_address ?? '',
            sala_id: salaId ?? null,
            fecha_inicio_utc:
              fechaInicioResult === undefined
                ? undefined
                : ((fechaInicioDate as Date | null | undefined) ?? null),
            fecha_fin_utc:
              fechaFinResult === undefined
                ? undefined
                : ((fechaFinDate as Date | null | undefined) ?? null),
            estado: autoEstado,
          } as any,
        });

        if (trainerIdsResult.length) {
          await tx.session_trainers.createMany({
            data: trainerIdsResult.map((trainerId) => ({
              session_id: created.id,
              trainer_id: trainerId,
            })),
          });
        }

        if (unidadIdsResult.length) {
          await tx.session_unidades.createMany({
            data: unidadIdsResult.map((unidadId) => ({
              session_id: created.id,
              unidad_id: unidadId,
            })),
          });
        }

        await reindexSessionNames(tx, product.id, baseName);

        const stored = await tx.sessions.findUnique({
          where: { id: created.id },
          include: {
            deal: { select: { sede_label: true, pipeline_id: true } },
            trainers: { select: { trainer_id: true } },
            unidades: { select: { unidad_id: true } },
          },
        });

        return normalizeSession(stored as unknown as SessionRecord);
      });

      return successResponse({ session: result }, 201);
    }

    if (method === 'PATCH' && sessionIdFromPath) {
      const body = parseJson(event.body);
      const result = buildSessionPatch(body);
      if ('error' in result) return result.error;

      const trainerIds = result.trainerIds;
      const unidadIds = result.unidadIds;
      const data = result.data;
      const requestedEstado = result.estado;

      const stored = await prisma.sessions.findUnique({
        where: { id: sessionIdFromPath },
        include: {
          deal: { select: { sede_label: true, pipeline_id: true } },
          trainers: { select: { trainer_id: true } },
          unidades: { select: { unidad_id: true } },
        },
      });

      if (!stored) {
        return errorResponse('NOT_FOUND', 'Sesión no encontrada', 404);
      }

      const storedRecord = stored as unknown as SessionRecord;

      const fechaInicio =
        data.fecha_inicio_utc === undefined
          ? storedRecord.fecha_inicio_utc
          : (data.fecha_inicio_utc as Date | null);
      const fechaFin =
        data.fecha_fin_utc === undefined
          ? storedRecord.fecha_fin_utc
          : (data.fecha_fin_utc as Date | null);
      const rangeError = ensureValidDateRange(fechaInicio, fechaFin);
      if (rangeError) return rangeError;

      const nextTrainerIds =
        trainerIds === undefined ? storedRecord.trainers.map((entry) => entry.trainer_id) : trainerIds;
      const nextUnidadIds =
        unidadIds === undefined ? storedRecord.unidades.map((entry) => entry.unidad_id) : unidadIds;

      let nextSalaId = stored.sala_id;
      if (Object.prototype.hasOwnProperty.call(data, 'sala_id')) {
        const rawSala = (data as Record<string, any>).sala_id as any;
        if (rawSala && typeof rawSala === 'object' && Object.prototype.hasOwnProperty.call(rawSala, 'set')) {
          nextSalaId = (rawSala.set as string | null | undefined) ?? null;
        } else {
          nextSalaId = (rawSala as string | null | undefined) ?? null;
        }
      }

      const storedEstado = toSessionEstado(storedRecord.estado);
      const currentEstado = storedEstado ?? 'BORRADOR';
      const autoEstado = computeAutomaticSessionEstadoFromValues({
        fechaInicio,
        fechaFin,
        salaId: nextSalaId,
        trainerIds: nextTrainerIds,
        unidadIds: nextUnidadIds,
        dealSede: storedRecord.deal?.sede_label ?? null,
        dealPipeline: storedRecord.deal?.pipeline_id ?? null,
      });

      if (requestedEstado !== undefined) {
        const isCurrentManual = isManualSessionEstado(currentEstado);
        const allowsBorradorToManual =
          currentEstado === 'BORRADOR' && isBorradorTransitionEstado(requestedEstado);
        const allowsManualToBorrador =
          requestedEstado === 'BORRADOR' && isBorradorTransitionEstado(currentEstado);

        if (!isManualSessionEstado(requestedEstado) && !allowsManualToBorrador) {
          return errorResponse('VALIDATION_ERROR', 'Estado no editable', 400);
        }
        if (!isCurrentManual && !allowsBorradorToManual && autoEstado !== 'PLANIFICADA') {
          return errorResponse(
            'VALIDATION_ERROR',
            'La sesión debe estar planificada para cambiar el estado',
            400,
          );
        }
        if (requestedEstado !== currentEstado) {
          (data as Record<string, SessionEstado>).estado = requestedEstado;
        }
      } else if (!isManualSessionEstado(currentEstado) && currentEstado !== autoEstado) {
        (data as Record<string, SessionEstado>).estado = autoEstado;
      }

      const updated = await prisma.$transaction(async (tx) => {
        await ensureResourcesAvailable(tx, {
          sessionId: sessionIdFromPath,
          trainerIds: nextTrainerIds,
          unidadIds: nextUnidadIds,
          salaId: nextSalaId,
          start: fechaInicio,
          end: fechaFin,
        });

        const patch = await tx.sessions.update({
          where: { id: sessionIdFromPath },
          data,
        });

        if (trainerIds !== undefined) {
          await tx.session_trainers.deleteMany({ where: { session_id: sessionIdFromPath } });
          if (trainerIds.length) {
            await tx.session_trainers.createMany({
              data: trainerIds.map((trainerId) => ({
                session_id: sessionIdFromPath,
                trainer_id: trainerId,
              })),
            });
          }
        }

        if (unidadIds !== undefined) {
          await tx.session_unidades.deleteMany({ where: { session_id: sessionIdFromPath } });
          if (unidadIds.length) {
            await tx.session_unidades.createMany({
              data: unidadIds.map((unidadId) => ({
                session_id: sessionIdFromPath,
                unidad_id: unidadId,
              })),
            });
          }
        }

        return patch;
      });

      const refreshed = await prisma.sessions.findUnique({
        where: { id: sessionIdFromPath },
        include: {
          deal: { select: { sede_label: true, pipeline_id: true } },
          trainers: { select: { trainer_id: true } },
          unidades: { select: { unidad_id: true } },
        },
      });

      return successResponse({ session: normalizeSession(refreshed as unknown as SessionRecord) });
    }

    if (method === 'DELETE' && sessionIdFromPath) {
      const existing = await prisma.sessions.findUnique({
        where: { id: sessionIdFromPath },
        select: { id: true, deal_product_id: true },
      });
      if (!existing) {
        return errorResponse('NOT_FOUND', 'Sesión no encontrada', 404);
      }

      await prisma.$transaction(async (tx) => {
        await tx.session_trainers.deleteMany({ where: { session_id: sessionIdFromPath } });
        await tx.session_unidades.deleteMany({ where: { session_id: sessionIdFromPath } });
        await tx.session_files.deleteMany({ where: { sesion_id: sessionIdFromPath } });
        await tx.sesiones_comentarios.deleteMany({ where: { sesion_id: sessionIdFromPath } });
        await tx.alumnos.deleteMany({ where: { sesion_id: sessionIdFromPath } });
        await tx.tokens.deleteMany({ where: { sesion_id: sessionIdFromPath } });

        await tx.sessions.delete({ where: { id: sessionIdFromPath } });
        const product = await tx.deal_products.findUnique({
          where: { id: existing.deal_product_id },
          select: { id: true, name: true, code: true },
        });
        if (product) {
          await reindexSessionNames(tx, product.id, buildNombreBase(product.name, product.code));
        }
      });

      return successResponse({});
    }

    return errorResponse('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      return error as any;
    }
    const message = error instanceof Error ? error.message : 'Error inesperado';
    return errorResponse('UNEXPECTED_ERROR', message, 500);
  }
};
