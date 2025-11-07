// backend/functions/products-variants.ts

import type { Prisma, PrismaClient } from '@prisma/client';
import {
  join,
  sqltag as sql,
  empty,
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
  Decimal,
} from '@prisma/client/runtime/library';

import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { buildMadridDateTime, formatTimeFromDb } from './_shared/time';
import { toMadridISOString } from './_shared/timezone';
import {
  getVariantResourceColumnsSupport,
  isVariantResourceColumnError,
  setVariantResourceColumnsSupport,
} from './_shared/variant-resources';
import { mapDbStockStatusToApiValue } from './_shared/variant-defaults';

const ALWAYS_AVAILABLE_UNIT_IDS = new Set(['52377f13-05dd-4830-88aa-0f5c78bee750']);

const VARIANT_TRAINER_TABLE = 'variant_trainer_links';
const VARIANT_UNIT_TABLE = 'variant_unit_links';

let variantTrainerLinksSupported: boolean | null = null;
let variantUnitLinksSupported: boolean | null = null;

function isMissingRelationError(error: unknown, relation: string): boolean {
  if (error instanceof PrismaClientKnownRequestError) {
    if (error.code === 'P2021' || error.code === 'P2022') {
      const message = typeof error.meta?.cause === 'string' ? error.meta.cause : error.message;
      return new RegExp(`(?:relation|table).*${relation}`, 'i').test(message);
    }
  }
  if (error instanceof PrismaClientUnknownRequestError) {
    return new RegExp(`(?:relation|table).*${relation}`, 'i').test(error.message);
  }
  if (error instanceof Error) {
    return new RegExp(`(?:relation|table).*${relation}`, 'i').test(error.message);
  }
  return false;
}

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

async function ensureVariantTrainerLinksTable(prisma: PrismaClientOrTx): Promise<boolean> {
  if (variantTrainerLinksSupported === false) return false;
  if (variantTrainerLinksSupported === true) return true;

  try {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS ${VARIANT_TRAINER_TABLE} (
        variant_id UUID NOT NULL,
        trainer_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (variant_id, trainer_id),
        CONSTRAINT ${VARIANT_TRAINER_TABLE}_variant_fk FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE,
        CONSTRAINT ${VARIANT_TRAINER_TABLE}_trainer_fk FOREIGN KEY (trainer_id) REFERENCES trainers(trainer_id) ON DELETE CASCADE
      );`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_${VARIANT_TRAINER_TABLE}_variant ON ${VARIANT_TRAINER_TABLE}(variant_id);`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_${VARIANT_TRAINER_TABLE}_trainer ON ${VARIANT_TRAINER_TABLE}(trainer_id);`,
    );
    variantTrainerLinksSupported = true;
  } catch (error) {
    variantTrainerLinksSupported = false;
    console.warn('[products-variants] variant trainer links unsupported', { error });
  }

  return variantTrainerLinksSupported === true;
}

async function ensureVariantUnitLinksTable(prisma: PrismaClientOrTx): Promise<boolean> {
  if (variantUnitLinksSupported === false) return false;
  if (variantUnitLinksSupported === true) return true;

  try {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS ${VARIANT_UNIT_TABLE} (
        variant_id UUID NOT NULL,
        unidad_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (variant_id, unidad_id),
        CONSTRAINT ${VARIANT_UNIT_TABLE}_variant_fk FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE,
        CONSTRAINT ${VARIANT_UNIT_TABLE}_unidad_fk FOREIGN KEY (unidad_id) REFERENCES unidades_moviles(unidad_id) ON DELETE CASCADE
      );`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_${VARIANT_UNIT_TABLE}_variant ON ${VARIANT_UNIT_TABLE}(variant_id);`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_${VARIANT_UNIT_TABLE}_unidad ON ${VARIANT_UNIT_TABLE}(unidad_id);`,
    );
    variantUnitLinksSupported = true;
  } catch (error) {
    variantUnitLinksSupported = false;
    console.warn('[products-variants] variant unit links unsupported', { error });
  }

  return variantUnitLinksSupported === true;
}

type VariantTrainerLink = {
  trainer_id: string;
  name: string | null;
  apellido: string | null;
  position: number;
};

type VariantUnitLink = {
  unidad_id: string;
  name: string | null;
  matricula: string | null;
  position: number;
};

function sanitizeIdArray(value: unknown): string[] | null {
  if (value === null) return [];
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : typeof value === 'string' || typeof value === 'number' ? [value] : null;
  if (!values) return null;

  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of values) {
    const trimmed = toTrimmed(entry);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

async function fetchVariantTrainerAssignments(
  prisma: PrismaClientOrTx,
  variantIds: string[],
): Promise<Map<string, VariantTrainerLink[]>> {
  const map = new Map<string, VariantTrainerLink[]>();
  if (!variantIds.length) return map;

  if (!(await ensureVariantTrainerLinksTable(prisma))) return map;

  try {
    const variantIdList = join(variantIds.map((id) => sql`${id}::uuid`));
    const rows = (await prisma.$queryRaw(
      sql`
        SELECT vtl.variant_id::text AS variant_id,
               vtl.trainer_id,
               t.name,
               t.apellido,
               vtl.position
        FROM variant_trainer_links vtl
        LEFT JOIN trainers t ON t.trainer_id = vtl.trainer_id
        WHERE vtl.variant_id IN (${variantIdList})
        ORDER BY vtl.variant_id, vtl.position ASC
      `,
    )) as Array<{ variant_id: string; trainer_id: string; name: string | null; apellido: string | null; position: number }>;

    for (const row of rows) {
      const list = map.get(row.variant_id) ?? [];
      list.push({
        trainer_id: row.trainer_id,
        name: row.name ?? null,
        apellido: row.apellido ?? null,
        position: row.position,
      });
      map.set(row.variant_id, list);
    }
  } catch (error) {
    if (isMissingRelationError(error, VARIANT_TRAINER_TABLE)) {
      variantTrainerLinksSupported = false;
      console.warn('[products-variants] variant trainer links query disabled (missing relation)', { error });
      return new Map();
    }
    throw error;
  }

  return map;
}

async function fetchVariantUnitAssignments(
  prisma: PrismaClientOrTx,
  variantIds: string[],
): Promise<Map<string, VariantUnitLink[]>> {
  const map = new Map<string, VariantUnitLink[]>();
  if (!variantIds.length) return map;

  if (!(await ensureVariantUnitLinksTable(prisma))) return map;

  try {
    const variantIdList = join(variantIds.map((id) => sql`${id}::uuid`));
    const rows = (await prisma.$queryRaw(
      sql`
        SELECT vul.variant_id::text AS variant_id,
               vul.unidad_id,
               u.name,
               u.matricula,
               vul.position
        FROM variant_unit_links vul
        LEFT JOIN unidades_moviles u ON u.unidad_id = vul.unidad_id
        WHERE vul.variant_id IN (${variantIdList})
        ORDER BY vul.variant_id, vul.position ASC
      `,
    )) as Array<{ variant_id: string; unidad_id: string; name: string | null; matricula: string | null; position: number }>;

    for (const row of rows) {
      const list = map.get(row.variant_id) ?? [];
      list.push({
        unidad_id: row.unidad_id,
        name: row.name ?? null,
        matricula: row.matricula ?? null,
        position: row.position,
      });
      map.set(row.variant_id, list);
    }
  } catch (error) {
    if (isMissingRelationError(error, VARIANT_UNIT_TABLE)) {
      variantUnitLinksSupported = false;
      console.warn('[products-variants] variant unit links query disabled (missing relation)', { error });
      return new Map();
    }
    throw error;
  }

  return map;
}

async function syncVariantTrainerAssignments(
  prisma: PrismaClientOrTx,
  variantId: string,
  trainerIds: string[],
): Promise<void> {
  if (!(await ensureVariantTrainerLinksTable(prisma))) return;

  const ids = trainerIds.filter((id) => toTrimmed(id));

  try {
    const tableName = VARIANT_TRAINER_TABLE;
    await prisma.$executeRaw(
      `DELETE FROM ${tableName} WHERE variant_id = $1::uuid`,
      variantId,
    );

    if (!ids.length) {
      return;
    }

    const values: any[] = [];
    const placeholders = ids
      .map((id, index) => {
        const baseIndex = index * 3;
        values.push(variantId, id, index);
        return `($${baseIndex + 1}::uuid, $${baseIndex + 2}, $${baseIndex + 3})`;
      })
      .join(', ');

    await prisma.$executeRaw(
      `INSERT INTO ${tableName} (variant_id, trainer_id, position)
       VALUES ${placeholders}
       ON CONFLICT (variant_id, trainer_id)
       DO UPDATE SET position = EXCLUDED.position, updated_at = NOW()`,
      ...values,
    );
  } catch (error) {
    if (isMissingRelationError(error, VARIANT_TRAINER_TABLE)) {
      variantTrainerLinksSupported = false;
      console.warn('[products-variants] variant trainer links sync disabled (missing relation)', { error });
      return;
    }
    throw error;
  }
}

async function syncVariantUnitAssignments(
  prisma: PrismaClientOrTx,
  variantId: string,
  unitIds: string[],
): Promise<void> {
  if (!(await ensureVariantUnitLinksTable(prisma))) return;

  const ids = unitIds.filter((id) => toTrimmed(id));

  try {
    const tableName = VARIANT_UNIT_TABLE;
    await prisma.$executeRaw(
      `DELETE FROM ${tableName} WHERE variant_id = $1::uuid`,
      variantId,
    );

    if (!ids.length) {
      return;
    }

    const values: any[] = [];
    const placeholders = ids
      .map((id, index) => {
        const baseIndex = index * 3;
        values.push(variantId, id, index);
        return `($${baseIndex + 1}::uuid, $${baseIndex + 2}, $${baseIndex + 3})`;
      })
      .join(', ');

    await prisma.$executeRaw(
      `INSERT INTO ${tableName} (variant_id, unidad_id, position)
       VALUES ${placeholders}
       ON CONFLICT (variant_id, unidad_id)
       DO UPDATE SET position = EXCLUDED.position, updated_at = NOW()`,
      ...values,
    );
  } catch (error) {
    if (isMissingRelationError(error, VARIANT_UNIT_TABLE)) {
      variantUnitLinksSupported = false;
      console.warn('[products-variants] variant unit links sync disabled (missing relation)', { error });
      return;
    }
    throw error;
  }
}

async function findVariantIdsByTrainerAssignments(
  prisma: PrismaClientOrTx,
  trainerIds: string[],
  excludeVariantId?: string,
): Promise<string[]> {
  if (!trainerIds.length) return [];
  if (!(await ensureVariantTrainerLinksTable(prisma))) return [];

  try {
    const trainerIdList = join(trainerIds.map((id) => sql`${id}`));
    const exclusionClause = excludeVariantId ? sql`AND variant_id <> ${excludeVariantId}::uuid` : empty;

    const rows = (await prisma.$queryRaw(
      sql`
        SELECT DISTINCT variant_id::text AS variant_id
        FROM variant_trainer_links
        WHERE trainer_id IN (${trainerIdList})
        ${exclusionClause}
      `,
    )) as Array<{ variant_id: string }>;

    return rows.map((row) => row.variant_id);
  } catch (error) {
    if (isMissingRelationError(error, VARIANT_TRAINER_TABLE)) {
      variantTrainerLinksSupported = false;
      console.warn('[products-variants] variant trainer lookup disabled (missing relation)', { error });
      return [];
    }
    throw error;
  }
}

async function findVariantIdsByUnitAssignments(
  prisma: PrismaClientOrTx,
  unitIds: string[],
  excludeVariantId?: string,
): Promise<string[]> {
  if (!unitIds.length) return [];
  if (!(await ensureVariantUnitLinksTable(prisma))) return [];

  try {
    const unitIdList = join(unitIds.map((id) => sql`${id}`));
    const exclusionClause = excludeVariantId ? sql`AND variant_id <> ${excludeVariantId}::uuid` : empty;

    const rows = (await prisma.$queryRaw(
      sql`
        SELECT DISTINCT variant_id::text AS variant_id
        FROM variant_unit_links
        WHERE unidad_id IN (${unitIdList})
        ${exclusionClause}
      `,
    )) as Array<{ variant_id: string }>;

    return rows.map((row) => row.variant_id);
  } catch (error) {
    if (isMissingRelationError(error, VARIANT_UNIT_TABLE)) {
      variantUnitLinksSupported = false;
      console.warn('[products-variants] variant unit lookup disabled (missing relation)', { error });
      return [];
    }
    throw error;
  }
}

type TimeParts = { hour: number; minute: number };

function toTrimmed(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function extractTimeParts(value: Date | string | null | undefined): TimeParts | null {
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

function buildDateTime(date: Date, time: TimeParts | null, fallback: TimeParts): Date {
  const parts = time ?? fallback;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return buildMadridDateTime({ year, month, day, hour: parts.hour, minute: parts.minute });
}

type DateRange = { start: Date; end: Date };

function normalizeDateRange(start: Date | null | undefined, end: Date | null | undefined): DateRange | null {
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

function computeVariantRange(
  variantDate: Date | string | null | undefined,
  productTimes: { hora_inicio: Date | string | null; hora_fin: Date | string | null },
): DateRange | null {
  if (!variantDate) return null;

  const parsedDate = new Date(variantDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const startTime = extractTimeParts(productTimes.hora_inicio);
  const endTime = extractTimeParts(productTimes.hora_fin);
  const fallbackStart: TimeParts = startTime ?? { hour: 9, minute: 0 };
  const fallbackEnd: TimeParts = endTime ?? (startTime ? { ...startTime } : { hour: 11, minute: 0 });

  const start = buildDateTime(parsedDate, startTime, fallbackStart);
  let end = buildDateTime(parsedDate, endTime, fallbackEnd);

  if (end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }

  return { start, end };
}

async function ensureVariantResourcesAvailable(
  prisma: PrismaClient,
  {
    excludeVariantId,
    trainerIds,
    salaId,
    unidadIds,
    range,
  }: {
    excludeVariantId?: string;
    trainerIds: string[];
    salaId: string | null;
    unidadIds: string[];
    range: DateRange | null;
  },
): Promise<ReturnType<typeof errorResponse> | null> {
  if (!range) return null;

  const normalizedTrainerIds = Array.from(
    new Set(
      trainerIds
        .map((value) => toTrimmed(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const normalizedSalaId = salaId ?? null;
  const normalizedUnidadIds = Array.from(
    new Set(
      unidadIds
        .map((value) => toTrimmed(value))
        .filter((value): value is string => Boolean(value))
        .filter((value) => !ALWAYS_AVAILABLE_UNIT_IDS.has(value)),
    ),
  );

  if (!normalizedTrainerIds.length && !normalizedSalaId && !normalizedUnidadIds.length) return null;
  if (getVariantResourceColumnsSupport() === false) return null;

  const sessionConditionsNew: Array<Record<string, unknown>> = [];
  const sessionConditionsLegacy: Array<Record<string, unknown>> = [];
  if (normalizedTrainerIds.length) {
    sessionConditionsNew.push({ trainers: { some: { trainer_id: { in: normalizedTrainerIds } } } });
    sessionConditionsLegacy.push({ sesion_trainers: { some: { trainer_id: { in: normalizedTrainerIds } } } });
  }
  if (normalizedSalaId) {
    sessionConditionsNew.push({ sala_id: normalizedSalaId });
    sessionConditionsLegacy.push({ sala_id: normalizedSalaId });
  }
  if (normalizedUnidadIds.length) {
    sessionConditionsNew.push({ unidades: { some: { unidad_movil_id: { in: normalizedUnidadIds } } } });
    sessionConditionsLegacy.push({ sesion_unidades: { some: { unidad_movil_id: { in: normalizedUnidadIds } } } });
  }

  if (sessionConditionsNew.length) {
    const sessionsClient = (prisma as unknown as { sessions?: { findMany: Function } }).sessions ?? null;
    const legacySessionsClient = (prisma as unknown as { sesiones?: { findMany: Function } }).sesiones ?? null;

    let sesiones: Array<{ fecha_inicio_utc: Date | null; fecha_fin_utc: Date | null }> = [];

    if (sessionsClient?.findMany) {
      sesiones = (await sessionsClient.findMany({
        where: { OR: sessionConditionsNew as any },
        select: { fecha_inicio_utc: true, fecha_fin_utc: true },
      })) as Array<{ fecha_inicio_utc: Date | null; fecha_fin_utc: Date | null }>;
    } else if (legacySessionsClient?.findMany) {
      sesiones = (await legacySessionsClient.findMany({
        where: { OR: sessionConditionsLegacy as any },
        select: { fecha_inicio_utc: true, fecha_fin_utc: true },
      })) as Array<{ fecha_inicio_utc: Date | null; fecha_fin_utc: Date | null }>;
    }

    if (sesiones.length) {
      const rangeStart = range.start.getTime();
      const rangeEnd = range.end.getTime();

      const hasSessionConflict = sesiones.some((session) => {
        const sessionRange = normalizeDateRange(session.fecha_inicio_utc, session.fecha_fin_utc);
        if (!sessionRange) return false;

        const sessionStart = sessionRange.start.getTime();
        const sessionEnd = sessionRange.end.getTime();

        return sessionStart <= rangeEnd && sessionEnd >= rangeStart;
      });

      if (hasSessionConflict) {
        return errorResponse(
          'RESOURCE_UNAVAILABLE',
          'Algunos recursos ya están asignados en las fechas seleccionadas.',
          409,
        );
      }
    }
  }

  const variantConditions: any[] = [];
  if (normalizedTrainerIds.length) variantConditions.push({ trainer_id: { in: normalizedTrainerIds } });
  if (normalizedSalaId) variantConditions.push({ sala_id: normalizedSalaId });
  if (normalizedUnidadIds.length) variantConditions.push({ unidad_movil_id: { in: normalizedUnidadIds } });

  const baseVariantWhere: Record<string, unknown> = {
    ...(excludeVariantId ? { id: { not: excludeVariantId } } : {}),
    date: { not: null },
  };

  const variantSelect = {
    id: true,
    date: true,
    trainer_id: true,
    sala_id: true,
    unidad_movil_id: true,
    products: { select: { hora_inicio: true, hora_fin: true } },
  } as const;

  let variantRecords: Array<{
    id: string;
    date: Date | string | null;
    trainer_id: string | null;
    sala_id: string | null;
    unidad_movil_id: string | null;
    products?: { hora_inicio: Date | string | null; hora_fin: Date | string | null } | null;
  }> = [];

  if (variantConditions.length) {
    try {
      const variants = await prisma.variants.findMany({
        where: { ...baseVariantWhere, OR: variantConditions as any },
        select: variantSelect,
      });
      setVariantResourceColumnsSupport(true);
      variantRecords = variants as any;
    } catch (error) {
      if (isVariantResourceColumnError(error)) {
        setVariantResourceColumnsSupport(false);
        console.warn(
          '[products-variants] skipping variant resource availability check (missing resource columns)',
          { error },
        );
        return null;
      }
      throw error;
    }
  }

  const trainerVariantIds = normalizedTrainerIds.length
    ? await findVariantIdsByTrainerAssignments(prisma, normalizedTrainerIds, excludeVariantId)
    : [];
  const unitVariantIds = normalizedUnidadIds.length
    ? await findVariantIdsByUnitAssignments(prisma, normalizedUnidadIds, excludeVariantId)
    : [];

  const candidateVariantIds = new Set<string>();
  variantRecords.forEach((variant) => candidateVariantIds.add(variant.id));
  trainerVariantIds.forEach((id) => candidateVariantIds.add(id));
  unitVariantIds.forEach((id) => candidateVariantIds.add(id));

  const missingIds = Array.from(candidateVariantIds).filter(
    (id) => !variantRecords.some((variant) => variant.id === id),
  );

  if (missingIds.length) {
    try {
      const extraVariants = await prisma.variants.findMany({
        where: { id: { in: missingIds } },
        select: variantSelect,
      });
      setVariantResourceColumnsSupport(true);
      variantRecords = variantRecords.concat(extraVariants as any);
    } catch (error) {
      if (isVariantResourceColumnError(error)) {
        setVariantResourceColumnsSupport(false);
        console.warn(
          '[products-variants] skipping variant resource availability enrichment (missing resource columns)',
          { error },
        );
        return null;
      }
      throw error;
    }
  }

  const variantIdsForAssignments = variantRecords.map((variant) => variant.id);
  let trainerAssignments = new Map<string, VariantTrainerLink[]>();
  let unitAssignments = new Map<string, VariantUnitLink[]>();

  if (variantIdsForAssignments.length) {
    const assignmentResults = await Promise.all([
      fetchVariantTrainerAssignments(prisma, variantIdsForAssignments),
      fetchVariantUnitAssignments(prisma, variantIdsForAssignments),
    ]);
    trainerAssignments = assignmentResults[0];
    unitAssignments = assignmentResults[1];
  }

  const normalizedTrainerSet = new Set(normalizedTrainerIds);
  const normalizedUnidadSet = new Set(normalizedUnidadIds);

  const hasVariantConflict = variantRecords.some((variant) => {
    if (excludeVariantId && variant.id === excludeVariantId) return false;

    const otherRange = computeVariantRange(
      variant.date,
      variant.products ?? { hora_inicio: null, hora_fin: null },
    );
    if (!otherRange) return false;

    const overlaps =
      otherRange.start.getTime() <= range.end.getTime() &&
      otherRange.end.getTime() >= range.start.getTime();
    if (!overlaps) return false;

    const trainerMatches = (() => {
      if (!normalizedTrainerIds.length) return false;
      const assigned = new Set<string>();
      const assignments = trainerAssignments.get(variant.id) ?? [];
      assignments.forEach((item) => {
        if (item.trainer_id) assigned.add(item.trainer_id);
      });
      const legacyTrainerId = toTrimmed(variant.trainer_id);
      if (legacyTrainerId) assigned.add(legacyTrainerId);
      return Array.from(assigned).some((id) => normalizedTrainerSet.has(id));
    })();

    const unidadMatches = (() => {
      if (!normalizedUnidadIds.length) return false;
      const assigned = new Set<string>();
      const assignments = unitAssignments.get(variant.id) ?? [];
      assignments.forEach((item) => {
        if (item.unidad_id) assigned.add(item.unidad_id);
      });
      const legacyUnidadId = toTrimmed(variant.unidad_movil_id);
      if (legacyUnidadId) assigned.add(legacyUnidadId);
      return Array.from(assigned).some((id) => normalizedUnidadSet.has(id));
    })();

    const salaConflict = normalizedSalaId && variant.sala_id === normalizedSalaId;

    return trainerMatches || unidadMatches || salaConflict;
  });

  if (hasVariantConflict) {
    return errorResponse(
      'RESOURCE_UNAVAILABLE',
      'Algunos recursos ya están asignados en las fechas seleccionadas.',
      409,
    );
  }

  return null;
}

const WOO_BASE = (process.env.WOO_BASE_URL || '').replace(/\/$/, '');
const WOO_KEY = process.env.WOO_KEY || '';
const WOO_SECRET = process.env.WOO_SECRET || '';

type VariantDeletionResult = { success: boolean; message?: string };

type WooVariationAttribute = {
  id?: number;
  name?: string;
  option?: string;
  slug?: string;
};

function ensureWooConfigured() {
  if (!WOO_BASE || !WOO_KEY || !WOO_SECRET) throw new Error('WooCommerce configuration missing');
}

function parseVariantIdFromPath(path: string): string | null {
  const value = String(path || '');
  const match = value.match(/\/(?:\.netlify\/functions\/)?products-variants\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

const LOCATION_KEYWORDS = ['localizacion', 'ubicacion', 'sede'];
const DATE_KEYWORDS = ['fecha'];

function normalizeAttributeText(value: string | undefined | null): string {
  if (!value) return '';
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function matchesAttributeKeywords(attribute: WooVariationAttribute, keywords: string[]): boolean {
  const normalizedName = normalizeAttributeText(attribute?.name ?? attribute?.slug ?? null);
  if (!normalizedName) return false;
  return keywords.some((keyword) => normalizedName.includes(keyword));
}

function formatDateAttributeValue(date: Date | null): string {
  if (!date) return '';
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${day}/${month}/${year}`;
}

type VariantUpdateInput = {
  price?: string | null;
  stock?: number | null;
  stock_status?: string | null;
  status?: string | null;
  sede?: string | null;
  date?: Date | null;
  trainer_id?: string | null;
  sala_id?: string | null;
  unidad_movil_id?: string | null;
};

type VariantWooUpdateInput = Pick<
  VariantUpdateInput,
  'price' | 'stock' | 'stock_status' | 'status' | 'sede' | 'date'
>;

async function fetchWooVariation(
  productWooId: bigint,
  variantWooId: bigint,
  authToken: string,
): Promise<{ attributes: WooVariationAttribute[] }> {
  const productId = productWooId.toString();
  const variationId = variantWooId.toString();
  const url = `${WOO_BASE}/wp-json/wc/v3/products/${productId}/variations/${variationId}`;

  let response: FetchResponse;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Basic ${authToken}`,
        Accept: 'application/json',
      },
    });
  } catch (error) {
    console.error('[products-variants] network error fetching WooCommerce variation', {
      productId,
      variationId,
      error,
    });
    throw new Error('No se pudo conectar con WooCommerce');
  }

  const text = await response.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      console.error('[products-variants] invalid JSON fetching WooCommerce variation', {
        productId,
        variationId,
        error,
        text,
      });
      throw new Error('Respuesta inválida de WooCommerce');
    }
  }

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && typeof data.message === 'string'
        ? data.message
        : `Error al consultar WooCommerce (status ${response.status})`;
    throw new Error(message);
  }

  const attributes = Array.isArray(data?.attributes) ? (data.attributes as WooVariationAttribute[]) : [];
  return { attributes };
}

async function updateVariantInWooCommerce(
  productWooId: bigint,
  variantWooId: bigint,
  updates: VariantWooUpdateInput,
): Promise<void> {
  ensureWooConfigured();

  const token = Buffer.from(`${WOO_KEY}:${WOO_SECRET}`).toString('base64');
  const productId = productWooId.toString();
  const variationId = variantWooId.toString();
  const url = `${WOO_BASE}/wp-json/wc/v3/products/${productId}/variations/${variationId}`;

  const body: Record<string, any> = {};

  if (Object.prototype.hasOwnProperty.call(updates, 'price')) {
    body.price = updates.price ?? '';
    body.regular_price = updates.price ?? '';
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'stock')) {
    if (updates.stock === null || updates.stock === undefined) {
      body.manage_stock = false;
      body.stock_quantity = null;
    } else {
      body.manage_stock = true;
      body.stock_quantity = updates.stock;
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'stock_status')) {
    body.stock_status = updates.stock_status ?? 'instock';
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
    body.status = updates.status ?? 'publish';
  }

  if (
    Object.prototype.hasOwnProperty.call(updates, 'sede') ||
    Object.prototype.hasOwnProperty.call(updates, 'date')
  ) {
    const { attributes } = await fetchWooVariation(productWooId, variantWooId, token);
    const updatedAttributes = attributes.map((a) => ({ ...a }));

    let attributesChanged = false;
    let sedeMatched = false;
    let dateMatched = false;

    if (Object.prototype.hasOwnProperty.call(updates, 'sede')) {
      const newValue = updates.sede ?? '';
      for (const attribute of updatedAttributes) {
        if (!matchesAttributeKeywords(attribute, LOCATION_KEYWORDS)) continue;
        sedeMatched = true;
        if ((attribute.option ?? '') !== newValue) {
          attribute.option = newValue;
          attributesChanged = true;
        }
      }
      if (!sedeMatched) {
        console.warn('[products-variants] no WooCommerce attribute matched for sede update', {
          productId,
          variationId,
        });
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'date')) {
      const newValue = formatDateAttributeValue(updates.date ?? null);
      for (const attribute of updatedAttributes) {
        if (!matchesAttributeKeywords(attribute, DATE_KEYWORDS)) continue;
        dateMatched = true;
        if ((attribute.option ?? '') !== newValue) {
          attribute.option = newValue;
          attributesChanged = true;
        }
      }
      if (!dateMatched) {
        console.warn('[products-variants] no WooCommerce attribute matched for date update', {
          productId,
          variationId,
        });
      }
    }

    if (attributesChanged) {
      body.attributes = updatedAttributes;
    }
  }

  if (!Object.keys(body).length) return;

  let response: FetchResponse;
  try {
    response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Basic ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error('[products-variants] network error updating WooCommerce variation', {
      productId,
      variationId,
      updates,
      error,
    });
    throw new Error('No se pudo conectar con WooCommerce');
  }

  const text = await response.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      console.error('[products-variants] invalid JSON updating WooCommerce variation', {
        productId,
        variationId,
        updates,
        error,
        text,
      });
      throw new Error('Respuesta inválida de WooCommerce');
    }
  }

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && typeof data.message === 'string'
        ? data.message
        : `Error al actualizar la variante en WooCommerce (status ${response.status})`;
    throw new Error(message);
  }
}

async function deleteVariantFromWooCommerce(
  productWooId: bigint,
  variantWooId: bigint,
): Promise<VariantDeletionResult> {
  ensureWooConfigured();

  const token = Buffer.from(`${WOO_KEY}:${WOO_SECRET}`).toString('base64');
  const productId = productWooId.toString();
  const variationId = variantWooId.toString();
  const url = `${WOO_BASE}/wp-json/wc/v3/products/${productId}/variations/${variationId}?force=true`;

  let response: FetchResponse;
  try {
    response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Basic ${token}`,
        Accept: 'application/json',
      },
    });
  } catch (error) {
    console.error('[products-variants] network error deleting WooCommerce variation', {
      productId,
      variationId,
      error,
    });
    throw new Error('No se pudo conectar con WooCommerce');
  }

  if (response.status === 404) {
    return { success: true, message: 'La variante no existe en WooCommerce, se eliminará localmente.' };
  }

  if (!response.ok) {
    const text = await response.text();
    let message = `Error al eliminar la variante en WooCommerce (status ${response.status})`;
    if (text) {
      try {
        const data = JSON.parse(text);
        if (data && typeof data === 'object' && typeof data.message === 'string') {
          message = data.message;
        }
      } catch (error) {
        console.error('[products-variants] invalid JSON deleting WooCommerce variation', {
          productId,
          variationId,
          error,
        });
      }
    }
    throw new Error(message);
  }

  return { success: true };
}

type VariantRecord = {
  id: string;
  id_woo: bigint;
  id_padre: bigint;
  name: string | null;
  status: string | null;
  price: Decimal | string | null;
  stock: number | null;
  stock_status: string | null;
  sede: string | null;
  date: Date | string | null;
  trainer_id?: string | null;
  sala_id?: string | null;
  unidad_movil_id?: string | null;
  products?: { hora_inicio: Date | string | null; hora_fin: Date | string | null } | null;
  trainers?: { trainer_id: string; name: string | null; apellido: string | null } | null;
  trainer_links?: VariantTrainerLink[];
  salas?: { sala_id: string; name: string; sede: string | null } | null;
  unidades_moviles?: { unidad_id: string; name: string; matricula: string | null } | null;
  unidad_links?: VariantUnitLink[];
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

type ProductRecord = {
  id: string;
  id_pipe: string;
  id_woo: bigint | null;
  name: string | null;
  code: string | null;
  category: string | null;
  hora_inicio: Date | string | null;
  hora_fin: Date | string | null;
  variant_start: Date | string | null;
  variant_end: Date | string | null;
  variant_stock_status: string | null;
  variant_stock_quantity: number | null;
  variant_price: Decimal | string | null;
  variants: VariantRecord[];
};

type LegacyProductRecord = Omit<
  ProductRecord,
  'variant_start' | 'variant_end' | 'variant_stock_status' | 'variant_stock_quantity' | 'variant_price'
>;

let productsDefaultFieldsSupported: boolean | null = null;

const PRODUCT_DEFAULT_COLUMN_PATTERNS = [
  /default_variant_(start|end|stock_status|stock_quantity|price)/i,
  /variant_(start|end|stock_status|stock_quantity|price)/i,
];

function isPrismaErrorInstance(error: unknown, ctor: unknown): boolean {
  if (!ctor || typeof ctor !== 'function') return false;
  try {
    return error instanceof (ctor as new (...args: any[]) => Error);
  } catch {
    return false;
  }
}

function isMissingProductDefaultColumns(error: unknown): boolean {
  if (isPrismaErrorInstance(error, PrismaClientKnownRequestError)) {
    return (error as PrismaClientKnownRequestError).code === 'P2021';
  }
  if (isPrismaErrorInstance(error, PrismaClientUnknownRequestError)) {
    return PRODUCT_DEFAULT_COLUMN_PATTERNS.some((p) => p.test((error as Error).message));
  }
  if (error instanceof Error) {
    return PRODUCT_DEFAULT_COLUMN_PATTERNS.some((p) => p.test(error.message));
  }
  return false;
}

async function findProducts(prisma: PrismaClient): Promise<ProductRecord[]> {
  const baseWhere = { id_woo: { not: null }, variants: { some: {} } };

  const buildVariantSelect = (includeResources: boolean): any => {
    const base = {
      id: true,
      id_woo: true,
      id_padre: true,
      name: true,
      status: true,
      price: true,
      stock: true,
      stock_status: true,
      sede: true,
      date: true,
      created_at: true,
      updated_at: true,
    };

    if (!includeResources) return base;

    return {
      ...base,
      trainer_id: true,
      sala_id: true,
      unidad_movil_id: true,
      trainers: { select: { trainer_id: true, name: true, apellido: true } },
      salas: { select: { sala_id: true, name: true, sede: true } },
      unidades_moviles: { select: { unidad_id: true, name: true, matricula: true } },
    };
  };

  const buildVariantsSelection = (includeResources: boolean) => ({
    orderBy: [{ date: 'asc' as const }, { name: 'asc' as const }],
    select: buildVariantSelect(includeResources),
  });

  const orderByName = [{ name: 'asc' as const }];

  const mapLegacyProducts = (products: LegacyProductRecord[]): ProductRecord[] =>
    products.map((p) => ({
      ...p,
      variant_start: null,
      variant_end: null,
      variant_stock_status: null,
      variant_stock_quantity: null,
      variant_price: null,
    }));

  let includeDefaults = productsDefaultFieldsSupported !== false;
  let includeVariantResources = getVariantResourceColumnsSupport() !== false;

  // Bucle de reintento con degradaciones controladas
  while (true) {
    const variantSelectionArgs = buildVariantsSelection(includeVariantResources);

    const select: Record<string, any> = includeDefaults
      ? {
          id: true,
          id_pipe: true,
          id_woo: true,
          name: true,
          code: true,
          category: true,
          hora_inicio: true,
          hora_fin: true,
          variant_start: true,
          variant_end: true,
          variant_stock_status: true,
          variant_stock_quantity: true,
          variant_price: true,
          variants: variantSelectionArgs,
        }
      : {
          id: true,
          id_pipe: true,
          id_woo: true,
          name: true,
          code: true,
          category: true,
          hora_inicio: true,
          hora_fin: true,
          variants: variantSelectionArgs,
        };

    try {
      const products = await prisma.products.findMany({
        where: baseWhere as any,
        select,
        orderBy: orderByName as any,
      });

      if (includeVariantResources) {
        const variantIds: string[] = [];
        for (const product of products as any[]) {
          if (!product?.variants) continue;
          for (const variant of product.variants as any[]) {
            if (variant?.id) variantIds.push(String(variant.id));
          }
        }

        if (variantIds.length) {
          const [trainerAssignments, unitAssignments] = await Promise.all([
            fetchVariantTrainerAssignments(prisma, variantIds),
            fetchVariantUnitAssignments(prisma, variantIds),
          ]);

          for (const product of products as any[]) {
            if (!product?.variants) continue;
            for (const variant of product.variants as any[]) {
              const variantId = String(variant.id);
              variant.trainer_links = trainerAssignments.get(variantId) ?? [];
              variant.unidad_links = unitAssignments.get(variantId) ?? [];
            }
          }
        }
      }

      if (!includeDefaults) {
        if (includeVariantResources) setVariantResourceColumnsSupport(true);
        const legacy = products as unknown as LegacyProductRecord[];
        return mapLegacyProducts(legacy);
      }

      productsDefaultFieldsSupported = true;
      if (includeVariantResources) setVariantResourceColumnsSupport(true);

      return products as unknown as ProductRecord[];
    } catch (error) {
      if (includeDefaults && isMissingProductDefaultColumns(error)) {
        productsDefaultFieldsSupported = false;
        includeDefaults = false;
        console.warn(
          '[products-variants] falling back to legacy product query (missing default variant columns)',
          { error },
        );
        continue;
      }

      if (includeVariantResources && isVariantResourceColumnError(error)) {
        setVariantResourceColumnsSupport(false);
        includeVariantResources = false;
        console.warn(
          '[products-variants] falling back to variant query without resource columns',
          { error },
        );
        continue;
      }

      throw error;
    }
  }
}

function normalizeVariant(record: VariantRecord) {
  const price =
    record.price == null ? null : typeof record.price === 'string' ? record.price : record.price.toString();

  const trainerLinks = Array.isArray(record.trainer_links) ? record.trainer_links : [];
  const trainerIdsFromLinks = trainerLinks
    .map((link) => toTrimmed(link.trainer_id))
    .filter((value): value is string => Boolean(value));
  const trainerRecordsFromLinks = trainerLinks
    .map((link) => {
      const trainerId = toTrimmed(link.trainer_id);
      if (!trainerId) return null;
      return {
        trainer_id: trainerId,
        name: link.name ?? null,
        apellido: link.apellido ?? null,
      } as const;
    })
    .filter((value): value is { trainer_id: string; name: string | null; apellido: string | null } => Boolean(value));

  const trainerRecordsMap = new Map(trainerRecordsFromLinks.map((item) => [item.trainer_id, item] as const));

  if (record.trainers?.trainer_id) {
    const trainerId = toTrimmed(record.trainers.trainer_id);
    if (trainerId) {
      if (!trainerRecordsMap.has(trainerId)) {
        trainerRecordsMap.set(trainerId, {
          trainer_id: trainerId,
          name: record.trainers.name ?? null,
          apellido: record.trainers.apellido ?? null,
        });
      }
    }
  }

  if (record.trainer_id) {
    const trainerId = toTrimmed(record.trainer_id);
    if (trainerId && !trainerRecordsMap.has(trainerId)) {
      trainerRecordsMap.set(trainerId, {
        trainer_id: trainerId,
        name: null,
        apellido: null,
      });
    }
  }

  const uniqueTrainerIds = Array.from(new Set([...trainerIdsFromLinks]));
  const trimmedTrainerId = toTrimmed(record.trainer_id);
  if (trimmedTrainerId && !uniqueTrainerIds.includes(trimmedTrainerId)) {
    uniqueTrainerIds.unshift(trimmedTrainerId);
  }

  const trainerRecords = Array.from(trainerRecordsMap.values());
  const primaryTrainerId = uniqueTrainerIds[0] ?? trimmedTrainerId ?? null;
  const trainerDetail = primaryTrainerId
    ? trainerRecords.find((item) => item.trainer_id === primaryTrainerId) ?? null
    : null;

  const unitLinks = Array.isArray(record.unidad_links) ? record.unidad_links : [];
  const unitIdsFromLinks = unitLinks
    .map((link) => toTrimmed(link.unidad_id))
    .filter((value): value is string => Boolean(value));
  const unitRecordsFromLinks = unitLinks
    .map((link) => {
      const unidadId = toTrimmed(link.unidad_id);
      if (!unidadId) return null;
      return {
        unidad_id: unidadId,
        name: link.name ?? '',
        matricula: link.matricula ?? null,
      } as const;
    })
    .filter((value): value is { unidad_id: string; name: string; matricula: string | null } => Boolean(value));

  const unitRecordsMap = new Map(unitRecordsFromLinks.map((item) => [item.unidad_id, item] as const));

  if (record.unidades_moviles?.unidad_id) {
    const unidadId = toTrimmed(record.unidades_moviles.unidad_id);
    if (unidadId) {
      if (!unitRecordsMap.has(unidadId)) {
        unitRecordsMap.set(unidadId, {
          unidad_id: unidadId,
          name: record.unidades_moviles.name,
          matricula: record.unidades_moviles.matricula ?? null,
        });
      }
    }
  }

  if (record.unidad_movil_id) {
    const unidadId = toTrimmed(record.unidad_movil_id);
    if (unidadId && !unitRecordsMap.has(unidadId)) {
      unitRecordsMap.set(unidadId, {
        unidad_id: unidadId,
        name: '',
        matricula: null,
      });
    }
  }

  const uniqueUnitIds = Array.from(new Set([...unitIdsFromLinks]));
  const trimmedUnitId = toTrimmed(record.unidad_movil_id);
  if (trimmedUnitId && !uniqueUnitIds.includes(trimmedUnitId)) {
    uniqueUnitIds.unshift(trimmedUnitId);
  }

  const unitRecords = Array.from(unitRecordsMap.values());
  const primaryUnitId = uniqueUnitIds[0] ?? trimmedUnitId ?? null;
  const unitDetail = primaryUnitId
    ? unitRecords.find((item) => item.unidad_id === primaryUnitId) ?? null
    : null;

  return {
    id: record.id,
    id_woo: record.id_woo?.toString(),
    id_padre: record.id_padre?.toString(),
    name: record.name ?? null,
    status: record.status ?? null,
    price,
    stock: record.stock ?? null,
    stock_status: record.stock_status ?? null,
    sede: record.sede ?? null,
    date: toMadridISOString(record.date),
    trainer_id: primaryTrainerId,
    trainer: trainerDetail,
    trainer_ids: uniqueTrainerIds,
    trainers: trainerRecords,
    sala_id: record.sala_id ?? null,
    sala: record.salas
      ? { sala_id: record.salas.sala_id, name: record.salas.name, sede: record.salas.sede ?? null }
      : null,
    unidad_movil_id: primaryUnitId,
    unidad: unitDetail,
    unidad_movil_ids: uniqueUnitIds,
    unidades: unitRecords,
    created_at: toMadridISOString(record.created_at),
    updated_at: toMadridISOString(record.updated_at),
  } as const;
}

function normalizeProduct(record: ProductRecord) {
  const defaultPrice =
    record.variant_price == null
      ? null
      : typeof record.variant_price === 'string'
        ? record.variant_price
        : record.variant_price.toString();

  return {
    id: record.id,
    id_pipe: record.id_pipe,
    id_woo: record.id_woo ? record.id_woo.toString() : null,
    name: record.name ?? null,
    code: record.code ?? null,
    category: record.category ?? null,
    hora_inicio: formatTimeFromDb(record.hora_inicio),
    hora_fin: formatTimeFromDb(record.hora_fin),
    variant_start: toMadridISOString(record.variant_start),
    variant_end: toMadridISOString(record.variant_end),
    variant_stock_status: mapDbStockStatusToApiValue(record.variant_stock_status),
    variant_stock_quantity: record.variant_stock_quantity ?? null,
    variant_price: defaultPrice,
    variants: record.variants.map(normalizeVariant),
  } as const;
}

export const handler = createHttpHandler<any>(async (request) => {
  const method = request.method;
  const prisma = getPrisma();

  if (method === 'PATCH') {
    const variantId = parseVariantIdFromPath(request.path || '');
    if (!variantId) return errorResponse('VALIDATION_ERROR', 'ID de variante requerido', 400);
    if (!request.rawBody) return errorResponse('VALIDATION_ERROR', 'Cuerpo de la petición requerido', 400);

    const payload = request.body && typeof request.body === 'object' ? (request.body as any) : {};
    const updates: VariantUpdateInput = {};

    if (Object.prototype.hasOwnProperty.call(payload, 'price')) {
      const rawPrice = payload.price;
      if (rawPrice == null || rawPrice === '') {
        updates.price = null;
      } else {
        const text = String(rawPrice).replace(',', '.').trim();
        if (!text || Number.isNaN(Number(text))) return errorResponse('VALIDATION_ERROR', 'Precio inválido', 400);
        updates.price = text;
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'stock')) {
      const rawStock = payload.stock;
      if (rawStock == null || rawStock === '') {
        updates.stock = null;
      } else {
        const numberValue = Number(rawStock);
        if (!Number.isFinite(numberValue)) return errorResponse('VALIDATION_ERROR', 'Stock inválido', 400);
        updates.stock = Math.trunc(numberValue);
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'stock_status')) {
      updates.stock_status =
        payload.stock_status == null || payload.stock_status === '' ? 'instock' : String(payload.stock_status).trim();
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
      if (payload.status == null || payload.status === '') {
        updates.status = 'publish';
      } else {
        const text = String(payload.status).trim().toLowerCase();
        if (text !== 'publish' && text !== 'private')
          return errorResponse('VALIDATION_ERROR', 'Estado de publicación inválido', 400);
        updates.status = text;
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'sede')) {
      updates.sede = payload.sede == null ? null : String(payload.sede).trim();
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'date')) {
      if (payload.date == null || payload.date === '') {
        updates.date = null;
      } else {
        const text = String(payload.date).trim();
        const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) {
          const [, y, m, d] = isoMatch;
          const year = Number.parseInt(y, 10);
          const month = Number.parseInt(m, 10);
          const day = Number.parseInt(d, 10);
          if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || month < 1 || month > 12 || day < 1 || day > 31) {
            return errorResponse('VALIDATION_ERROR', 'Fecha inválida', 400);
          }
          updates.date = new Date(Date.UTC(year, month - 1, day));
        } else {
          const parsed = new Date(text);
          if (Number.isNaN(parsed.getTime())) return errorResponse('VALIDATION_ERROR', 'Fecha inválida', 400);
          updates.date = parsed;
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'trainer_id')) updates.trainer_id = toTrimmed(payload.trainer_id);
    if (Object.prototype.hasOwnProperty.call(payload, 'sala_id')) updates.sala_id = toTrimmed(payload.sala_id);
    if (Object.prototype.hasOwnProperty.call(payload, 'unidad_movil_id'))
      updates.unidad_movil_id = toTrimmed(payload.unidad_movil_id);

    let trainerIdsUpdate: string[] | undefined;
    if (Object.prototype.hasOwnProperty.call(payload, 'trainer_ids')) {
      const parsed = sanitizeIdArray(payload.trainer_ids);
      if (parsed === null) return errorResponse('VALIDATION_ERROR', 'Lista de formadores inválida', 400);
      trainerIdsUpdate = parsed;
    }

    let unidadIdsUpdate: string[] | undefined;
    if (Object.prototype.hasOwnProperty.call(payload, 'unidad_movil_ids')) {
      const parsed = sanitizeIdArray(payload.unidad_movil_ids);
      if (parsed === null) return errorResponse('VALIDATION_ERROR', 'Lista de unidades móviles inválida', 400);
      unidadIdsUpdate = parsed;
    }

    const hasResourceArrayUpdates = trainerIdsUpdate !== undefined || unidadIdsUpdate !== undefined;

    if (!Object.keys(updates).length && !hasResourceArrayUpdates)
      return errorResponse('VALIDATION_ERROR', 'No se proporcionaron cambios', 400);

    const existing = await prisma.variants.findUnique({
      where: { id: variantId },
      select: {
        id: true,
        id_woo: true,
        id_padre: true,
        name: true,
        status: true,
        price: true,
        stock: true,
        stock_status: true,
        sede: true,
        date: true,
        trainer_id: true,
        sala_id: true,
        unidad_movil_id: true,
        products: { select: { hora_inicio: true, hora_fin: true } },
      },
    });
    if (!existing) return errorResponse('NOT_FOUND', 'Variante no encontrada', 404);

    const [existingTrainerAssignments, existingUnitAssignments] = await Promise.all([
      fetchVariantTrainerAssignments(prisma, [variantId]),
      fetchVariantUnitAssignments(prisma, [variantId]),
    ]);

    const normalizedExistingTrainerIds = Array.from(
      new Set(
        (existingTrainerAssignments.get(variantId)?.map((item) => item.trainer_id) ?? [])
          .map((value) => toTrimmed(value))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const trimmedExistingTrainerId = toTrimmed(existing.trainer_id);
    if (trimmedExistingTrainerId && !normalizedExistingTrainerIds.includes(trimmedExistingTrainerId)) {
      normalizedExistingTrainerIds.unshift(trimmedExistingTrainerId);
    }

    const normalizedExistingUnitIds = Array.from(
      new Set(
        (existingUnitAssignments.get(variantId)?.map((item) => item.unidad_id) ?? [])
          .map((value) => toTrimmed(value))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const trimmedExistingUnidadId = toTrimmed(existing.unidad_movil_id);
    if (trimmedExistingUnidadId && !normalizedExistingUnitIds.includes(trimmedExistingUnidadId)) {
      normalizedExistingUnitIds.unshift(trimmedExistingUnidadId);
    }

    const nextTrainerIds = trainerIdsUpdate !== undefined ? trainerIdsUpdate : normalizedExistingTrainerIds;
    const nextUnidadIds = unidadIdsUpdate !== undefined ? unidadIdsUpdate : normalizedExistingUnitIds;

    const nextTrainerId =
      trainerIdsUpdate !== undefined
        ? nextTrainerIds[0] ?? null
        : Object.prototype.hasOwnProperty.call(updates, 'trainer_id')
          ? updates.trainer_id ?? null
          : trimmedExistingTrainerId ?? null;
    const nextSalaId    = Object.prototype.hasOwnProperty.call(updates, 'sala_id')    ? updates.sala_id ?? null    : existing.sala_id ?? null;
    const nextUnidadId =
      unidadIdsUpdate !== undefined
        ? nextUnidadIds[0] ?? null
        : Object.prototype.hasOwnProperty.call(updates, 'unidad_movil_id')
          ? updates.unidad_movil_id ?? null
          : trimmedExistingUnidadId ?? null;
    const nextSede      = Object.prototype.hasOwnProperty.call(updates, 'sede') ? updates.sede ?? null : existing.sede ?? null;
    const nextDate      = Object.prototype.hasOwnProperty.call(updates, 'date') ? updates.date ?? null : existing.date ?? null;

    if (nextSede && nextSalaId && nextSede.trim().toLowerCase() === 'sabadell') {
      const room = await prisma.salas.findUnique({ where: { sala_id: nextSalaId }, select: { sala_id: true, sede: true } });
      if (!room) return errorResponse('VALIDATION_ERROR', 'La sala seleccionada no existe', 400);
      if ((room.sede ?? '').trim().toLowerCase() !== 'gep sabadell') {
        return errorResponse('VALIDATION_ERROR', 'La sala seleccionada no pertenece a GEP Sabadell.', 400);
      }
    }

    const productTimes = existing.products ?? { hora_inicio: null, hora_fin: null };
    const variantRange = computeVariantRange(nextDate, productTimes);

    const availabilityError = await ensureVariantResourcesAvailable(prisma, {
      excludeVariantId: existing.id,
      trainerIds: nextTrainerIds,
      salaId: nextSalaId,
      unidadIds: nextUnidadIds,
      range: variantRange,
    });
    if (availabilityError) return availabilityError;

    if (trainerIdsUpdate !== undefined) updates.trainer_id = nextTrainerId;
    if (unidadIdsUpdate !== undefined) updates.unidad_movil_id = nextUnidadId;

    const wooUpdates: VariantWooUpdateInput = {};
    if ('price' in updates) wooUpdates.price = updates.price ?? null;
    if ('stock' in updates) wooUpdates.stock = updates.stock ?? null;
    if ('stock_status' in updates) wooUpdates.stock_status = updates.stock_status ?? null;
    if ('status' in updates) wooUpdates.status = updates.status ?? null;
    if ('sede' in updates) wooUpdates.sede = updates.sede ?? null;
    if ('date' in updates) wooUpdates.date = updates.date ?? null;

    if (Object.keys(wooUpdates).length) {
      try {
        await updateVariantInWooCommerce(existing.id_padre, existing.id_woo, wooUpdates);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo actualizar la variante en WooCommerce';
        return errorResponse('WOO_UPDATE_ERROR', message, 502);
      }
    }

    const timestamp = new Date();
    const data: any = { updated_at: timestamp };
    if ('price' in updates) data.price = updates.price == null ? null : new Decimal(updates.price);
    if ('stock' in updates) data.stock = updates.stock ?? null;
    if ('stock_status' in updates) data.stock_status = updates.stock_status ?? null;
    if ('status' in updates) data.status = updates.status ?? null;
    if ('sede' in updates) data.sede = updates.sede ?? null;
    if ('date' in updates) data.date = updates.date ?? null;
    if ('trainer_id' in updates) data.trainer_id = updates.trainer_id ?? null;
    if ('sala_id' in updates) data.sala_id = updates.sala_id ?? null;
    if ('unidad_movil_id' in updates) data.unidad_movil_id = updates.unidad_movil_id ?? null;

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.variants.update({ where: { id: variantId }, data });
      if (trainerIdsUpdate !== undefined) {
        await syncVariantTrainerAssignments(tx, variantId, nextTrainerIds);
      }
      if (unidadIdsUpdate !== undefined) {
        await syncVariantUnitAssignments(tx, variantId, nextUnidadIds);
      }
    });

    const refreshed = await prisma.variants.findUnique({
      where: { id: variantId },
      select: {
        id: true,
        id_woo: true,
        id_padre: true,
        name: true,
        status: true,
        price: true,
        stock: true,
        stock_status: true,
        sede: true,
        date: true,
        trainer_id: true,
        sala_id: true,
        unidad_movil_id: true,
        trainers: { select: { trainer_id: true, name: true, apellido: true } },
        salas: { select: { sala_id: true, name: true, sede: true } },
        unidades_moviles: { select: { unidad_id: true, name: true, matricula: true } },
        created_at: true,
        updated_at: true,
      },
    });

    const [refreshedTrainerAssignments, refreshedUnitAssignments] = await Promise.all([
      fetchVariantTrainerAssignments(prisma, [variantId]),
      fetchVariantUnitAssignments(prisma, [variantId]),
    ]);

    const enrichedRefreshed =
      refreshed &&
      ({
        ...(refreshed as any),
        trainer_links: refreshedTrainerAssignments.get(variantId) ?? [],
        unidad_links: refreshedUnitAssignments.get(variantId) ?? [],
      } as VariantRecord);

    return successResponse({ ok: true, variant: enrichedRefreshed ? normalizeVariant(enrichedRefreshed) : null });
  }

  if (method === 'DELETE') {
    const variantId = parseVariantIdFromPath(request.path || '');
    if (!variantId) return errorResponse('VALIDATION_ERROR', 'ID de variante requerido', 400);

    const variant = await prisma.variants.findUnique({
      where: { id: variantId },
      select: { id: true, id_padre: true, id_woo: true },
    });
    if (!variant) return errorResponse('NOT_FOUND', 'Variante no encontrada', 404);

    let wooMessage: string | undefined;
    try {
      const result = await deleteVariantFromWooCommerce(variant.id_padre, variant.id_woo);
      wooMessage = result.message;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo eliminar la variante en WooCommerce';
      return errorResponse('WOO_DELETE_ERROR', message, 502);
    }

    await prisma.variants.delete({ where: { id: variantId } });
    return successResponse({ ok: true, message: wooMessage ?? 'Variante eliminada correctamente' });
  }

  if (method !== 'GET') return errorResponse('METHOD_NOT_ALLOWED', 'Método no soportado', 405);

  const productsRaw = await findProducts(prisma);
  const products = productsRaw.map(normalizeProduct);
  return successResponse({ products });
});
