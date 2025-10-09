// backend/functions/trainers.ts
import { randomUUID } from 'crypto';
import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import { toMadridISOString } from './_shared/timezone';
import {
  findTrainersConflicts,
  type ResourceConflictDetail,
} from './_lib/resource-conflicts';

const OPTIONAL_STRING_FIELDS = [
  'apellido',
  'email',
  'phone',
  'dni',
  'direccion',
  'especialidad',
  'titulacion',
] as const;

const VALID_SEDES = ['GEP Arganda', 'GEP Sabadell', 'In company'] as const;

type TrainerRecord = {
  trainer_id: string;
  name: string;
  apellido: string | null;
  email: string | null;
  phone: string | null;
  dni: string | null;
  direccion: string | null;
  especialidad: string | null;
  titulacion: string | null;
  activo: boolean;
  sede: string[] | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

function parseTrainerIdFromPath(path: string): string | null {
  const value = String(path || '');
  const match = value.match(/\/(?:\.netlify\/functions\/)?trainers\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function toNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

type TrainerAvailability = {
  isBusy: boolean;
  conflicts: ResourceConflictDetail[];
};

function normalizeTrainer(row: TrainerRecord, availability?: TrainerAvailability) {
  const sedeValues = Array.isArray(row.sede) ? row.sede : [];
  const normalizedSede = sedeValues.filter(
    (value): value is string =>
      typeof value === 'string' && VALID_SEDES.includes(value as (typeof VALID_SEDES)[number])
  );

  return {
    trainer_id: row.trainer_id,
    name: row.name,
    apellido: row.apellido,
    email: row.email,
    phone: row.phone,
    dni: row.dni,
    direccion: row.direccion,
    especialidad: row.especialidad,
    titulacion: row.titulacion,
    activo: Boolean(row.activo),
    sede: normalizedSede,
    created_at: toMadridISOString(row.created_at),
    updated_at: toMadridISOString(row.updated_at),
    availability: availability ? { ...availability } : undefined,
  };
}

type DateRangeParseResult =
  | { start: Date | null; end: Date | null; excludeSessionId: string | null }
  | { error: ReturnType<typeof errorResponse> };

function parseDateRangeParams(query: Record<string, unknown>): DateRangeParseResult {
  const startRaw = query.start ?? query.start_at ?? query.inicio ?? null;
  const endRaw = query.end ?? query.end_at ?? query.fin ?? null;
  const excludeRaw =
    query.excludeSessionId ??
    query.exclude_session_id ??
    query.sessionId ??
    query.session_id ??
    null;

  const startText = toNullableString(startRaw);
  const endText = toNullableString(endRaw);
  const excludeSessionId = toNullableString(excludeRaw);

  let start: Date | null = null;
  let end: Date | null = null;

  if (startText) {
    const parsed = new Date(startText);
    if (Number.isNaN(parsed.getTime())) {
      return {
        error: errorResponse(
          'VALIDATION_ERROR',
          'El parámetro start debe ser una fecha ISO válida',
          400,
        ),
      };
    }
    start = parsed;
  }

  if (endText) {
    const parsed = new Date(endText);
    if (Number.isNaN(parsed.getTime())) {
      return {
        error: errorResponse(
          'VALIDATION_ERROR',
          'El parámetro end debe ser una fecha ISO válida',
          400,
        ),
      };
    }
    end = parsed;
  }

  if (start && end && end.getTime() <= start.getTime()) {
    return {
      error: errorResponse(
        'VALIDATION_ERROR',
        'El rango horario es inválido. end debe ser posterior a start',
        400,
      ),
    };
  }

  return { start, end, excludeSessionId };
}

type ParseSedeResult =
  | { values: string[] }
  | { error: ReturnType<typeof errorResponse> };

function parseSedeInput(input: unknown): ParseSedeResult {
  if (input === undefined || input === null) {
    return { values: [] as string[] };
  }

  if (!Array.isArray(input)) {
    return {
      error: errorResponse(
        'VALIDATION_ERROR',
        'El campo sede debe ser un array de strings',
        400,
      ),
    };
  }

  const rawValues = input;
  const values: string[] = [];

  for (const raw of rawValues) {
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (!value.length) continue;
    if (!VALID_SEDES.includes(value as (typeof VALID_SEDES)[number])) {
      return {
        error: errorResponse(
          'VALIDATION_ERROR',
          'El campo sede contiene valores no válidos',
          400
        ),
      };
    }
    if (!values.includes(value)) {
      values.push(value);
    }
  }

  return { values };
}

function buildCreateData(body: any) {
  const name = toNullableString(body?.name);
  if (!name) {
    return { error: errorResponse('VALIDATION_ERROR', 'El campo name es obligatorio', 400) };
  }

  const trainerId = toNullableString(body?.trainer_id) ?? randomUUID();

  const data: any = {
    trainer_id: trainerId,
    name,
    activo: body?.activo === undefined || body?.activo === null ? true : Boolean(body.activo),
  };

  for (const field of OPTIONAL_STRING_FIELDS) {
    data[field] = toNullableString(body?.[field]);
  }

  const sedeResult = parseSedeInput(body?.sede);
  if ('error' in sedeResult) {
    return { error: sedeResult.error };
  }
  data.sede = sedeResult.values;

  return { data };
}

function buildUpdateData(body: any) {
  if (!body || typeof body !== 'object') {
    return { error: errorResponse('VALIDATION_ERROR', 'Body inválido', 400) };
  }

  const data: Record<string, any> = {};
  let hasChanges = false;

  if (Object.prototype.hasOwnProperty.call(body, 'trainer_id')) {
    const newId = toNullableString(body.trainer_id);
    if (newId) {
      data.trainer_id = newId;
      hasChanges = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = toNullableString(body.name);
    if (!name) {
      return { error: errorResponse('VALIDATION_ERROR', 'El campo name es obligatorio', 400) };
    }
    data.name = name;
    hasChanges = true;
  }

  for (const field of OPTIONAL_STRING_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      data[field] = toNullableString(body[field]);
      hasChanges = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'sede')) {
    const sedeResult = parseSedeInput(body.sede);
    if ('error' in sedeResult) {
      return { error: sedeResult.error };
    }
    data.sede = sedeResult.values;
    hasChanges = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'activo')) {
    data.activo = Boolean(body.activo);
    hasChanges = true;
  }

  if (!hasChanges) {
    return { error: errorResponse('VALIDATION_ERROR', 'No se han proporcionado cambios', 400) };
  }

  return { data };
}

type PrismaKnownError = {
  code: string;
  meta?: { target?: string | string[] };
};

function isPrismaKnownError(error: unknown): error is PrismaKnownError {
  return Boolean(error && typeof error === 'object' && 'code' in error && typeof (error as any).code === 'string');
}

function handleKnownPrismaError(error: unknown) {
  if (isPrismaKnownError(error) && error.code === 'P2002') {
    const target = Array.isArray(error.meta?.target)
      ? error.meta?.target.join(', ')
      : String(error.meta?.target ?? 'registro');
    return errorResponse('UNIQUE_CONSTRAINT', `Ya existe un formador con ${target}`, 409);
  }

  return null;
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    const prisma = getPrisma();
    const method = event.httpMethod;
    const path = event.path || '';
    const trainerIdFromPath = parseTrainerIdFromPath(path);

    if (method === 'GET' && !trainerIdFromPath) {
      const rangeResult = parseDateRangeParams(event.queryStringParameters ?? {});
      if ('error' in rangeResult) {
        return rangeResult.error;
      }

      const { start: rangeStart, end: rangeEnd, excludeSessionId } = rangeResult;
      const hasRange = Boolean(rangeStart && rangeEnd);

      const trainers = await prisma.trainers.findMany({
        orderBy: [{ name: 'asc' }, { apellido: 'asc' }],
      });

      let availabilityMap = new Map<string, ResourceConflictDetail[]>();
      if (hasRange && trainers.length) {
        availabilityMap = await findTrainersConflicts(
          prisma,
          trainers.map((trainer) => trainer.trainer_id),
          { start: rangeStart as Date, end: rangeEnd as Date, excludeSessionId },
        );
      }

      return successResponse({
        trainers: trainers.map((trainer: TrainerRecord) => {
          const conflicts = hasRange
            ? availabilityMap.get(trainer.trainer_id) ?? []
            : [];
          const availability = hasRange
            ? { isBusy: conflicts.length > 0, conflicts }
            : undefined;
          return normalizeTrainer(trainer, availability);
        }),
      });
    }

    if (method === 'GET' && trainerIdFromPath) {
      const trainer = await prisma.trainers.findUnique({
        where: { trainer_id: trainerIdFromPath },
      });
      if (!trainer) {
        return errorResponse('NOT_FOUND', 'Formador/Bombero no encontrado', 404);
      }
      return successResponse({ trainer: normalizeTrainer(trainer as TrainerRecord) });
    }

    if (method === 'POST') {
      if (!event.body) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }
      const body = JSON.parse(event.body || '{}');
      const result = buildCreateData(body);
      if ('error' in result) return result.error;

      const created = await prisma.trainers.create({ data: result.data });
      return successResponse({ trainer: normalizeTrainer(created) }, 201);
    }

    if (method === 'PATCH' && trainerIdFromPath) {
      if (!event.body) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }

      const existing = await prisma.trainers.findUnique({ where: { trainer_id: trainerIdFromPath } });
      if (!existing) {
        return errorResponse('NOT_FOUND', 'Formador/Bombero no encontrado', 404);
      }

      const body = JSON.parse(event.body || '{}');
      const result = buildUpdateData(body);
      if ('error' in result) return result.error;

      const updated = await prisma.trainers.update({
        where: { trainer_id: trainerIdFromPath },
        data: result.data,
      });

      return successResponse({ trainer: normalizeTrainer(updated) });
    }

    return errorResponse('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (error: unknown) {
    const handled = handleKnownPrismaError(error);
    if (handled) return handled;

    const message = error instanceof Error ? error.message : 'Error inesperado';
    return errorResponse('UNEXPECTED_ERROR', message, 500);
  }
};
