// backend/functions/session-imports.ts
import type { Prisma, SessionEstado } from '@prisma/client';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { compareSessionsForOrder } from './_shared/sessions';
import { preflightResponse, successResponse, errorResponse } from './_shared/response';

type SessionImportRow = {
  dealId: string;
  sessionNumber: string;
  start: string;
  end: string;
  trainer: string;
  trainerSup: string;
  estado: string;
};

type SessionImportRequest = {
  dealId: string;
  rows: SessionImportRow[];
};

type ParsedImportRow = {
  dealId: string;
  sessionNumber: string;
  start: Date;
  end: Date;
  trainer: string;
  trainerSup: string;
  estado: SessionEstado;
};

type SessionStateMapping = Partial<Record<string, SessionEstado>>;

const STATE_MAP: SessionStateMapping = {
  borrador: 'BORRADOR',
  planificada: 'PLANIFICADA',
  suspendida: 'SUSPENDIDA',
  cancelada: 'CANCELADA',
  finalizada: 'FINALIZADA',
};

const COMPANY_PIPELINES = [
  'formacion empresa',
  'formacion empresas',
  'formación empresa',
  'formación empresas',
];

const LEGACY_UNIT_NAME = 'Sin Unidad Móvil (0000)';

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length ? trimmed : '';
}

function normalizePipeline(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  return trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isCompanyPipeline(label: unknown): boolean {
  const normalized = normalizePipeline(label);
  if (!normalized) return false;
  return COMPANY_PIPELINES.includes(normalized);
}

function parseExcelSerial(value: number): Date | null {
  const base = Date.UTC(1899, 11, 30); // Excel epoch
  const millis = value * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(millis)) return null;
  const date = new Date(base + millis);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateTime(value: unknown): Date | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    return parseExcelSerial(value);
  }

  const text = normalizeText(value);
  if (!text) return null;

  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    const serialDate = parseExcelSerial(numeric);
    if (serialDate) return serialDate;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseEstado(value: unknown): SessionEstado {
  const normalized = normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  return STATE_MAP[normalized] ?? 'BORRADOR';
}

function shuffle<T>(items: T[]): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function resolveTrainerId(prisma: Prisma.TransactionClient, name: string): Promise<string | null> {
  if (!name) return null;

  const direct = await prisma.trainers.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
  if (direct?.trainer_id) return direct.trainer_id;

  const parts = name.split(/\s+/);
  if (parts.length >= 2) {
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ');
    const composite = await prisma.trainers.findFirst({
      where: {
        AND: [
          { name: { contains: firstName, mode: 'insensitive' } },
          { apellido: { contains: lastName, mode: 'insensitive' } },
        ],
      },
    });
    if (composite?.trainer_id) return composite.trainer_id;
  }

  const fallback = await prisma.trainers.findFirst({
    where: {
      OR: [
        { name: { contains: name, mode: 'insensitive' } },
        { apellido: { contains: name, mode: 'insensitive' } },
      ],
    },
  });

  return fallback?.trainer_id ?? null;
}

function hasOverlap(rangeA: { start: Date; end: Date }, rangeB: { start: Date; end: Date }): boolean {
  return rangeA.start.getTime() <= rangeB.end.getTime() && rangeA.end.getTime() >= rangeB.start.getTime();
}

function parseRows(payload: SessionImportRequest): ParsedImportRow[] | null {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rows.length) return null;

  const parsed = rows
    .map((row) => {
      const sessionNumber = normalizeText((row as any)?.sessionNumber);
      const start = parseDateTime((row as any)?.start);
      const end = parseDateTime((row as any)?.end);
      const trainer = normalizeText((row as any)?.trainer);
      const trainerSup = normalizeText((row as any)?.trainerSup);
      const estado = parseEstado((row as any)?.estado);
      const dealId = normalizeText(payload.dealId);

      if (!dealId || !sessionNumber || !start || !end) return null;
      if (end.getTime() <= start.getTime()) return null;

      return { dealId, sessionNumber, start, end, trainer, trainerSup, estado } as ParsedImportRow;
    })
    .filter((row): row is ParsedImportRow => Boolean(row));

  return parsed.length ? parsed : null;
}

export const handler = async (event: any) => {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();

  try {
    const prisma = getPrisma();
    const auth = await requireAuth(event, prisma, {
      requireRoles: ['Admin', 'Logistica', 'Administracion', 'People'],
    });

    if ('error' in auth) {
      return auth.error;
    }

    if (event.httpMethod !== 'POST') {
      return errorResponse('METHOD_NOT_ALLOWED', 'Solo se permite POST', 405);
    }

    let payload: SessionImportRequest | null = null;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return errorResponse('INVALID_BODY', 'El formato del cuerpo no es válido', 400);
    }

    const dealId = normalizeText(payload?.dealId);
    if (!dealId) return errorResponse('VALIDATION_ERROR', 'dealId es obligatorio', 400);

    const parsedRows = payload ? parseRows(payload) : null;
    if (!parsedRows) {
      return errorResponse('VALIDATION_ERROR', 'No se encontraron sesiones válidas en la solicitud', 400);
    }

    const deal = await prisma.deals.findUnique({
      where: { deal_id: dealId },
      include: { deal_products: true },
    });

    if (!deal) return errorResponse('NOT_FOUND', 'Presupuesto no encontrado', 404);

    const dealProductId = deal.deal_products?.[0]?.id;
    if (!dealProductId) {
      return errorResponse('VALIDATION_ERROR', 'El presupuesto no tiene productos asociados', 400);
    }

    const [existingSessions, salas, legacyUnit] = await Promise.all([
      prisma.sesiones.findMany({
        where: { deal_id: dealId },
        include: { sesion_trainers: true, sesion_unidades: true },
      }),
      prisma.salas.findMany(),
      prisma.unidades_moviles.findFirst({ where: { name: { equals: LEGACY_UNIT_NAME, mode: 'insensitive' } } }),
    ]);

    const globalSalaSessions = await prisma.sesiones.findMany({
      where: { sala_id: { not: null } },
      select: { id: true, sala_id: true, fecha_inicio_utc: true, fecha_fin_utc: true },
    });

    const existingSorted = existingSessions.slice().sort(compareSessionsForOrder);
    const newSorted = parsedRows.slice().sort((a, b) => a.sessionNumber.localeCompare(b.sessionNumber, 'es', { numeric: true }));

    const updatesCount = Math.min(existingSorted.length, newSorted.length);
    const deletions = existingSorted.slice(newSorted.length);
    const creations = newSorted.slice(existingSorted.length);

    const plannedSalaAssignments: Array<{ sessionId: string | null; sala_id: string; start: Date; end: Date }> = [];
    const deletionsIds = new Set(deletions.map((item) => item.id));

    const findSalaForRange = (start: Date, end: Date, currentId: string | null): string | null => {
      if (isCompanyPipeline(deal.pipeline_label)) return null;

      const candidates = shuffle(salas.map((s) => s.sala_id));
      return (
        candidates.find((candidate) => {
          const overlapsDb = globalSalaSessions.some((session) => {
            if (session.sala_id !== candidate) return false;
            if (!session.fecha_inicio_utc || !session.fecha_fin_utc) return false;
            if (deletionsIds.has(session.id)) return false;
            if (currentId && session.id === currentId) return false;
            return hasOverlap({ start, end }, { start: new Date(session.fecha_inicio_utc), end: new Date(session.fecha_fin_utc) });
          });
          if (overlapsDb) return false;

          const overlapsPlanned = plannedSalaAssignments.some((assignment) => {
            if (assignment.sala_id !== candidate) return false;
            if (currentId && assignment.sessionId === currentId) return false;
            return hasOverlap({ start, end }, { start: assignment.start, end: assignment.end });
          });

          return !overlapsPlanned;
        }) ?? null
      );
    };

    const result = await prisma.$transaction(async (tx) => {
      let created = 0;
      let updated = 0;
      let removed = 0;

      for (let i = 0; i < updatesCount; i += 1) {
        const session = existingSorted[i];
        const row = newSorted[i];

        const sala_id = findSalaForRange(row.start, row.end, session.id);
        if (sala_id) plannedSalaAssignments.push({ sessionId: session.id, sala_id, start: row.start, end: row.end });

        const mainTrainerId = await resolveTrainerId(tx, row.trainer);
        const supTrainerId = await resolveTrainerId(tx, row.trainerSup);

        await tx.sesiones.update({
          where: { id: session.id },
          data: {
            deal_product_id: session.deal_product_id || dealProductId,
            nombre_cache: session.nombre_cache || `Sesión ${row.sessionNumber}`,
            fecha_inicio_utc: row.start,
            fecha_fin_utc: row.end,
            sala_id,
            direccion: session.direccion || deal.training_address || '',
            estado: row.estado,
          },
        });

        await tx.sesion_trainers.deleteMany({ where: { sesion_id: session.id } });
        const trainerLinks = [mainTrainerId, supTrainerId].filter(Boolean).map((trainerId) => ({
          sesion_id: session.id,
          trainer_id: trainerId as string,
        }));
        if (trainerLinks.length) {
          await tx.sesion_trainers.createMany({ data: trainerLinks, skipDuplicates: true });
        }

        await tx.sesion_unidades.deleteMany({ where: { sesion_id: session.id } });
        if (legacyUnit?.unidad_id) {
          await tx.sesion_unidades.create({ data: { sesion_id: session.id, unidad_movil_id: legacyUnit.unidad_id } });
        }

        updated += 1;
      }

      for (const obsolete of deletions) {
        await tx.sesiones.delete({ where: { id: obsolete.id } });
        removed += 1;
      }

      for (const row of creations) {
        const sala_id = findSalaForRange(row.start, row.end, null);
        if (sala_id) plannedSalaAssignments.push({ sessionId: null, sala_id, start: row.start, end: row.end });

        const session = await tx.sesiones.create({
          data: {
            deal_id: dealId,
            deal_product_id: dealProductId,
            nombre_cache: `Sesión ${row.sessionNumber}`,
            fecha_inicio_utc: row.start,
            fecha_fin_utc: row.end,
            sala_id,
            direccion: deal.training_address || '',
            estado: row.estado,
          },
        });

        const mainTrainerId = await resolveTrainerId(tx, row.trainer);
        const supTrainerId = await resolveTrainerId(tx, row.trainerSup);
        const trainerLinks = [mainTrainerId, supTrainerId].filter(Boolean).map((trainerId) => ({
          sesion_id: session.id,
          trainer_id: trainerId as string,
        }));
        if (trainerLinks.length) {
          await tx.sesion_trainers.createMany({ data: trainerLinks, skipDuplicates: true });
        }

        if (legacyUnit?.unidad_id) {
          await tx.sesion_unidades.create({ data: { sesion_id: session.id, unidad_movil_id: legacyUnit.unidad_id } });
        }

        created += 1;
      }

      return { created, updated, removed };
    });

    return successResponse({
      dealId,
      created: result.created,
      updated: result.updated,
      removed: result.removed,
      message: 'Sesiones procesadas correctamente.',
    });
  } catch (err) {
    if (err && typeof err === 'object' && 'statusCode' in (err as any)) return err as any;
    const message = err instanceof Error ? err.message : 'Error inesperado';
    return errorResponse('UNEXPECTED_ERROR', message, 500);
  }
};

export default handler;
