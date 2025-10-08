// backend/functions/trainers.ts
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';

const OPTIONAL_STRING_FIELDS = [
  'apellido',
  'email',
  'phone',
  'dni',
  'direccion',
  'especialidad',
  'titulacion',
] as const;

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

function normalizeTrainer(row: TrainerRecord) {
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
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at ?? null,
    updated_at:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ?? null,
  };
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

  if (Object.prototype.hasOwnProperty.call(body, 'activo')) {
    data.activo = Boolean(body.activo);
    hasChanges = true;
  }

  if (!hasChanges) {
    return { error: errorResponse('VALIDATION_ERROR', 'No se han proporcionado cambios', 400) };
  }

  return { data };
}

function handleKnownPrismaError(error: Prisma.PrismaClientKnownRequestError) {
  if (error.code === 'P2002') {
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
      const trainers = await prisma.trainers.findMany({
        orderBy: [{ name: 'asc' }, { apellido: 'asc' }],
      });
      return successResponse({ trainers: trainers.map((trainer) => normalizeTrainer(trainer)) });
    }

    if (method === 'GET' && trainerIdFromPath) {
      const trainer = await prisma.trainers.findUnique({
        where: { trainer_id: trainerIdFromPath },
      });
      if (!trainer) {
        return errorResponse('NOT_FOUND', 'Formador/Bombero no encontrado', 404);
      }
      return successResponse({ trainer: normalizeTrainer(trainer) });
    }

    if (method === 'POST') {
      if (!event.body) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }
      const body = JSON.parse(event.body || '{}');
      const { data, error } = buildCreateData(body);
      if (error) return error;

      const created = await prisma.trainers.create({ data });
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
      const { data, error } = buildUpdateData(body);
      if (error) return error;

      const updated = await prisma.trainers.update({
        where: { trainer_id: trainerIdFromPath },
        data,
      });

      return successResponse({ trainer: normalizeTrainer(updated) });
    }

    return errorResponse('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const handled = handleKnownPrismaError(error);
      if (handled) return handled;
    }

    const message = error?.message ?? 'Error inesperado';
    return errorResponse('UNEXPECTED_ERROR', message, 500);
  }
};
