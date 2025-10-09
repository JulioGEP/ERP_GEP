// backend/functions/rooms.ts
import { randomUUID } from 'crypto';
import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import { toMadridISOString } from './_shared/timezone';

const VALID_SEDES = ['GEP Arganda', 'GEP Sabadell', 'In company'] as const;

type RoomRecord = {
  sala_id: string;
  name: string;
  sede: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

function parseRoomIdFromPath(path: string): string | null {
  const value = String(path || '');
  const match = value.match(/\/(?:\.netlify\/functions\/)?rooms\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function toNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function normalizeRoom(row: RoomRecord) {
  return {
    sala_id: row.sala_id,
    name: row.name,
    sede: row.sede ?? null,
    created_at: toMadridISOString(row.created_at),
    updated_at: toMadridISOString(row.updated_at),
  };
}

type ParseSedeResult = { value: string } | { error: ReturnType<typeof errorResponse> };

function parseSedeInput(input: unknown): ParseSedeResult {
  const value = toNullableString(input);
  if (!value) {
    return { error: errorResponse('VALIDATION_ERROR', 'El campo sede es obligatorio', 400) };
  }

  if (!VALID_SEDES.includes(value as (typeof VALID_SEDES)[number])) {
    return {
      error: errorResponse('VALIDATION_ERROR', 'El campo sede contiene un valor no válido', 400),
    };
  }

  return { value };
}

function buildCreateData(body: any) {
  const name = toNullableString(body?.name);
  if (!name) {
    return { error: errorResponse('VALIDATION_ERROR', 'El campo name es obligatorio', 400) };
  }

  const sedeResult = parseSedeInput(body?.sede);
  if ('error' in sedeResult) {
    return { error: sedeResult.error };
  }

  const salaId = toNullableString(body?.sala_id) ?? randomUUID();

  return {
    data: {
      sala_id: salaId,
      name,
      sede: sedeResult.value,
    },
  };
}

function buildUpdateData(body: any) {
  if (!body || typeof body !== 'object') {
    return { error: errorResponse('VALIDATION_ERROR', 'Body inválido', 400) };
  }

  const data: Record<string, any> = {};
  let hasChanges = false;

  if (Object.prototype.hasOwnProperty.call(body, 'sala_id')) {
    const newId = toNullableString(body.sala_id);
    if (newId) {
      data.sala_id = newId;
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

  if (Object.prototype.hasOwnProperty.call(body, 'sede')) {
    const sedeResult = parseSedeInput(body.sede);
    if ('error' in sedeResult) {
      return { error: sedeResult.error };
    }
    data.sede = sedeResult.value;
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
    return errorResponse('UNIQUE_CONSTRAINT', `Ya existe una sala con ${target}`, 409);
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
    const roomIdFromPath = parseRoomIdFromPath(path);

    if (method === 'GET' && !roomIdFromPath) {
      const searchRaw = event.queryStringParameters?.search ?? '';
      const search = typeof searchRaw === 'string' ? searchRaw.trim() : '';

      const where = search
        ? {
            name: {
              contains: search,
              mode: 'insensitive',
            },
          }
        : undefined;

      const rooms = await prisma.salas.findMany({
        where,
        orderBy: [{ name: 'asc' }],
      });

      return successResponse({
        rooms: rooms.map((room: RoomRecord) => normalizeRoom(room)),
      });
    }

    if (method === 'GET' && roomIdFromPath) {
      const room = await prisma.salas.findUnique({
        where: { sala_id: roomIdFromPath },
      });

      if (!room) {
        return errorResponse('NOT_FOUND', 'Sala no encontrada', 404);
      }

      return successResponse({ room: normalizeRoom(room as RoomRecord) });
    }

    if (method === 'POST') {
      if (!event.body) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }

      const body = JSON.parse(event.body || '{}');
      const result = buildCreateData(body);
      if ('error' in result) return result.error;

      const created = await prisma.salas.create({ data: result.data });
      return successResponse({ room: normalizeRoom(created as RoomRecord) }, 201);
    }

    if (method === 'PATCH' && roomIdFromPath) {
      if (!event.body) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }

      const existing = await prisma.salas.findUnique({ where: { sala_id: roomIdFromPath } });
      if (!existing) {
        return errorResponse('NOT_FOUND', 'Sala no encontrada', 404);
      }

      const body = JSON.parse(event.body || '{}');
      const result = buildUpdateData(body);
      if ('error' in result) return result.error;

      const updated = await prisma.salas.update({
        where: { sala_id: roomIdFromPath },
        data: result.data,
      });

      return successResponse({ room: normalizeRoom(updated as RoomRecord) });
    }

    return errorResponse('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (error: unknown) {
    const handled = handleKnownPrismaError(error);
    if (handled) return handled;

    const message = error instanceof Error ? error.message : 'Error inesperado';
    return errorResponse('UNEXPECTED_ERROR', message, 500);
  }
};
