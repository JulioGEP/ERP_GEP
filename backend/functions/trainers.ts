// backend/functions/trainers.ts
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { toMadridISOString } from './_shared/timezone';
import { syncUserForTrainer, type TrainerRecordForUserSync } from './_shared/trainerUsers';

const OPTIONAL_STRING_FIELDS = [
  'apellido',
  'email',
  'phone',
  'dni',
  'direccion',
  'especialidad',
  'titulacion',
] as const;

const OPTIONAL_DATE_FIELDS = [
  'revision_medica_caducidad',
  'epis_caducidad',
  'dni_caducidad',
  'carnet_conducir_caducidad',
  'certificado_bombero_caducidad',
] as const;

const VALID_SEDES = ['GEP Arganda', 'GEP Sabadell', 'In company'] as const;
const MAX_TRAINER_NAME_LENGTH = 17;

function normalizeNomina(value: Prisma.Decimal | number | string | null): number | null {
  if (value === undefined || value === null) return null;

  try {
    const decimalValue = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
    return decimalValue.toNumber();
  } catch (error) {
    console.error('normalizeNomina error', error);
    return null;
  }
}

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
  nomina: Prisma.Decimal | number | string | null;
  contrato_fijo: boolean;
  revision_medica_caducidad: Date | string | null;
  epis_caducidad: Date | string | null;
  dni_caducidad: Date | string | null;
  carnet_conducir_caducidad: Date | string | null;
  certificado_bombero_caducidad: Date | string | null;
  activo: boolean;
  sede?: string[] | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  user_id: string | null;
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

function normalizeTrainer(row: TrainerRecord) {
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
    nomina: normalizeNomina(row.nomina),
    contrato_fijo: Boolean(row.contrato_fijo),
    revision_medica_caducidad: toMadridISOString(row.revision_medica_caducidad),
    epis_caducidad: toMadridISOString(row.epis_caducidad),
    dni_caducidad: toMadridISOString(row.dni_caducidad),
    carnet_conducir_caducidad: toMadridISOString(row.carnet_conducir_caducidad),
    certificado_bombero_caducidad: toMadridISOString(row.certificado_bombero_caducidad),
    activo: Boolean(row.activo),
    sede: normalizedSede,
    created_at: toMadridISOString(row.created_at),
    updated_at: toMadridISOString(row.updated_at),
    user_id: row.user_id,
  };
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

type ParseDateResult =
  | { value: Date | null }
  | { error: ReturnType<typeof errorResponse> };

function parseDateField(
  fieldName: (typeof OPTIONAL_DATE_FIELDS)[number],
  input: unknown,
): ParseDateResult {
  if (input === undefined) {
    return { value: null };
  }

  if (input === null) {
    return { value: null };
  }

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) {
      return {
        error: errorResponse(
          'VALIDATION_ERROR',
          `El campo ${fieldName} debe ser una fecha válida`,
          400,
        ),
      };
    }
    return { value: input };
  }

  const toDate = (value: string | number): ParseDateResult => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed.length) {
        return { value: null };
      }
      const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
        ? `${trimmed}T00:00:00.000Z`
        : trimmed;
      const date = new Date(normalized);
      if (Number.isNaN(date.getTime())) {
        return {
          error: errorResponse(
            'VALIDATION_ERROR',
            `El campo ${fieldName} debe ser una fecha válida`,
            400,
          ),
        };
      }
      return { value: date };
    }

    if (typeof value === 'number') {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return {
          error: errorResponse(
            'VALIDATION_ERROR',
            `El campo ${fieldName} debe ser una fecha válida`,
            400,
          ),
        };
      }
      return { value: date };
    }

    return {
      error: errorResponse(
        'VALIDATION_ERROR',
        `El campo ${fieldName} debe ser una fecha válida`,
        400,
      ),
    };
  };

  if (typeof input === 'string' || typeof input === 'number') {
    return toDate(input);
  }

  return {
    error: errorResponse(
      'VALIDATION_ERROR',
      `El campo ${fieldName} debe ser una fecha válida`,
      400,
    ),
  };
}

type ParseNominaResult =
  | { value: Prisma.Decimal | null }
  | { error: ReturnType<typeof errorResponse> };

function parseNominaField(input: unknown): ParseNominaResult {
  if (input === undefined || input === null) {
    return { value: null };
  }

  if (input instanceof Prisma.Decimal) {
    return { value: input };
  }

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      return {
        error: errorResponse('VALIDATION_ERROR', 'El campo nomina debe ser un número válido', 400),
      };
    }
    return { value: new Prisma.Decimal(input) };
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed.length) return { value: null };

    const normalized = trimmed.replace('€', '').replace(',', '.');
    const parsed = Number(normalized);
    if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
      return {
        error: errorResponse('VALIDATION_ERROR', 'El campo nomina debe ser un número válido', 400),
      };
    }
    return { value: new Prisma.Decimal(parsed) };
  }

  return {
    error: errorResponse('VALIDATION_ERROR', 'El campo nomina debe ser un número válido', 400),
  };
}

function buildCreateData(body: any) {
  const name = toNullableString(body?.name);
  if (!name) {
    return { error: errorResponse('VALIDATION_ERROR', 'El campo name es obligatorio', 400) };
  }

  if (name.length > MAX_TRAINER_NAME_LENGTH) {
    return {
      error: errorResponse(
        'VALIDATION_ERROR',
        `El campo name no puede superar los ${MAX_TRAINER_NAME_LENGTH} caracteres`,
        400,
      ),
    };
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

  for (const field of OPTIONAL_DATE_FIELDS) {
    const result = parseDateField(field, body?.[field]);
    if ('error' in result) {
      return { error: result.error };
    }
    data[field] = result.value;
  }

  const sedeResult = parseSedeInput(body?.sede);
  if ('error' in sedeResult) {
    return { error: sedeResult.error };
  }
  data.sede = sedeResult.values;

  const nominaResult = parseNominaField(body?.nomina);
  if ('error' in nominaResult) {
    return { error: nominaResult.error };
  }

  const contratoFijo = Boolean(body?.contrato_fijo);
  data.contrato_fijo = contratoFijo;
  data.nomina = contratoFijo ? nominaResult.value : null;

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

    if (name.length > MAX_TRAINER_NAME_LENGTH) {
      return {
        error: errorResponse(
          'VALIDATION_ERROR',
          `El campo name no puede superar los ${MAX_TRAINER_NAME_LENGTH} caracteres`,
          400,
        ),
      };
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

  for (const field of OPTIONAL_DATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      const result = parseDateField(field, body[field]);
      if ('error' in result) {
        return { error: result.error };
      }
      data[field] = result.value;
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

  if (Object.prototype.hasOwnProperty.call(body, 'nomina')) {
    const nominaResult = parseNominaField(body.nomina);
    if ('error' in nominaResult) {
      return { error: nominaResult.error };
    }
    data.nomina = nominaResult.value;
    hasChanges = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'contrato_fijo')) {
    const contratoFijo = Boolean(body.contrato_fijo);
    data.contrato_fijo = contratoFijo;
    hasChanges = true;
    if (!contratoFijo && !Object.prototype.hasOwnProperty.call(body, 'nomina')) {
      data.nomina = null;
    }
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

const SYNC_FIELDS: Array<keyof TrainerRecord> = [
  'trainer_id',
  'name',
  'apellido',
  'email',
  'activo',
  'user_id',
];

function pickTrainerSyncFields(trainer: TrainerRecord): TrainerRecordForUserSync {
  return SYNC_FIELDS.reduce((acc, key) => {
    (acc as any)[key] = trainer[key];
    return acc;
  }, {} as TrainerRecordForUserSync);
}

export const handler = createHttpHandler<any>(async (request) => {
  const prisma = getPrisma();
  const method = request.method;
  const path = request.path || '';
  const trainerIdFromPath = parseTrainerIdFromPath(path);

  try {
    if (method === 'GET' && !trainerIdFromPath) {
      const trainers = await prisma.trainers.findMany({
        orderBy: [{ name: 'asc' }, { apellido: 'asc' }],
        select: {
          trainer_id: true,
          name: true,
          apellido: true,
          email: true,
          phone: true,
          dni: true,
          direccion: true,
          especialidad: true,
          titulacion: true,
          nomina: true,
          contrato_fijo: true,
          revision_medica_caducidad: true,
          epis_caducidad: true,
          dni_caducidad: true,
          carnet_conducir_caducidad: true,
          certificado_bombero_caducidad: true,
          activo: true,
          sede: true,
          created_at: true,
          updated_at: true,
          user_id: true,
        },
      });
      return successResponse({
        trainers: trainers.map((trainer: TrainerRecord) => normalizeTrainer(trainer)),
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
      if (!request.rawBody) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }
      const body =
        request.body && typeof request.body === 'object' ? (request.body as any) : {};
      const result = buildCreateData(body);
      if ('error' in result) return result.error;

      // Transacción: crear trainer → sincronizar user → devolver trainer normalizado
      const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const newTrainer = await tx.trainers.create({ data: result.data });
        await syncUserForTrainer(tx, pickTrainerSyncFields(newTrainer as TrainerRecord));
        return tx.trainers.findUnique({ where: { trainer_id: newTrainer.trainer_id } });
      });

      return successResponse({ trainer: normalizeTrainer(created as any) }, 201);
    }

    if (method === 'PATCH' && trainerIdFromPath) {
      if (!request.rawBody) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }

      const existing = await prisma.trainers.findUnique({ where: { trainer_id: trainerIdFromPath } });
      if (!existing) {
        return errorResponse('NOT_FOUND', 'Formador/Bombero no encontrado', 404);
      }

      const body =
        request.body && typeof request.body === 'object' ? (request.body as any) : {};
      const result = buildUpdateData(body);
      if ('error' in result) return result.error;

      const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const tr = await tx.trainers.update({
          where: { trainer_id: trainerIdFromPath },
          data: result.data,
        });

        await syncUserForTrainer(tx, pickTrainerSyncFields(tr as TrainerRecord));

        return tx.trainers.findUnique({ where: { trainer_id: tr.trainer_id } });
      });

      return successResponse({ trainer: normalizeTrainer(updated as any) });
    }

    return errorResponse('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (error: unknown) {
    const handled = handleKnownPrismaError(error);
    if (handled) return handled;

    const message = error instanceof Error ? error.message : 'Error inesperado';
    return errorResponse('UNEXPECTED_ERROR', message, 500);
  }
});
