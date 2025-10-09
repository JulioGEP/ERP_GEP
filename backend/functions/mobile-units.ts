// backend/functions/mobile-units.ts
import { randomUUID } from 'crypto';
import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';

type MobileUnitRecord = {
  unidad_id: string;
  name: string;
  matricula: string;
  tipo: string[] | string | null;
  sede: string[] | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

const VALID_SEDE = ["GEP Arganda", "GEP Sabadell", "In Company"] as const;
const VALID_TIPO = ["Formación", "Preventivo", "PCI", "Remolque"] as const;

type SelectionValidationResult =
  | { value: string[] }
  | { error: ReturnType<typeof errorResponse> };

function parseUnitIdFromPath(path: string): string | null {
  const value = String(path || '');
  const match = value.match(/\/(?:\.netlify\/functions\/)?mobile-units\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function toTrimmedString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function mapSelectionValues(value: unknown, validValues: readonly string[]) {
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const normalized = items
    .map((item) => (item === undefined || item === null ? '' : String(item).trim()))
    .filter((item) => item.length);

  const mapped: string[] = [];

  for (const entry of normalized) {
    const match = validValues.find((valid) => valid.toLowerCase() === entry.toLowerCase());
    if (match && !mapped.includes(match)) {
      mapped.push(match);
    }
  }

  return mapped;
}

function normalizeMobileUnit(row: MobileUnitRecord) {
  const tipo = mapSelectionValues(row.tipo, VALID_TIPO);
  const sede = mapSelectionValues(row.sede, VALID_SEDE);

  return {
    unidad_id: row.unidad_id,
    name: row.name,
    matricula: row.matricula,
    tipo,
    sede,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at ?? null,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ?? null,
  };
}

function normalizeSelection(
  value: unknown,
  validValues: readonly string[],
  fieldName: string,
  { required = true }: { required?: boolean } = {},
): SelectionValidationResult {
  const items = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const normalized = items
    .map((item) => (item === undefined || item === null ? "" : String(item).trim()))
    .filter((item) => item.length);

  const mappedValues: string[] = [];
  const invalidValues: string[] = [];

  for (const entry of normalized) {
    const match = validValues.find((valid) => valid.toLowerCase() === entry.toLowerCase());
    if (match) {
      if (!mappedValues.includes(match)) {
        mappedValues.push(match);
      }
    } else if (!invalidValues.includes(entry)) {
      invalidValues.push(entry);
    }
  }

  if (invalidValues.length) {
    return {
      error: errorResponse(
        "VALIDATION_ERROR",
        `Los valores [${invalidValues.join(", ")}] no son válidos para ${fieldName}`,
        400
      ),
    };
  }

  if (required && mappedValues.length === 0) {
    return {
      error: errorResponse("VALIDATION_ERROR", `El campo ${fieldName} es obligatorio`, 400),
    };
  }

  return { value: mappedValues };
}

function buildCreateData(body: any) {
  const name = toTrimmedString(body?.name);
  const matricula = toTrimmedString(body?.matricula);
  const tipoResult = normalizeSelection(body?.tipo, VALID_TIPO, "tipo");
  if ("error" in tipoResult) return tipoResult;
  const sedeResult = normalizeSelection(body?.sede, VALID_SEDE, "sede");
  if ("error" in sedeResult) return sedeResult;

  if (!name) {
    return { error: errorResponse('VALIDATION_ERROR', 'El campo name es obligatorio', 400) };
  }
  if (!matricula) {
    return { error: errorResponse('VALIDATION_ERROR', 'El campo matricula es obligatorio', 400) };
  }

  const unidadId = toTrimmedString(body?.unidad_id) ?? randomUUID();

  const data = {
    unidad_id: unidadId,
    name,
    matricula,
    tipo: tipoResult.value,
    sede: sedeResult.value,
  };

  return { data };
}

function buildUpdateData(body: any) {
  if (!body || typeof body !== 'object') {
    return { error: errorResponse('VALIDATION_ERROR', 'Body inválido', 400) };
  }

  const data: Record<string, any> = {};
  let hasChanges = false;

  if (Object.prototype.hasOwnProperty.call(body, 'unidad_id')) {
    const newId = toTrimmedString(body.unidad_id);
    if (newId) {
      data.unidad_id = newId;
      hasChanges = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = toTrimmedString(body.name);
    if (!name) {
      return { error: errorResponse('VALIDATION_ERROR', 'El campo name es obligatorio', 400) };
    }
    data.name = name;
    hasChanges = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'matricula')) {
    const matricula = toTrimmedString(body.matricula);
    if (!matricula) {
      return { error: errorResponse('VALIDATION_ERROR', 'El campo matricula es obligatorio', 400) };
    }
    data.matricula = matricula;
    hasChanges = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'tipo')) {
    const tipoResult = normalizeSelection(body.tipo, VALID_TIPO, 'tipo');
    if ('error' in tipoResult) return tipoResult;
    data.tipo = tipoResult.value;
    hasChanges = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'sede')) {
    const sedeResult = normalizeSelection(body.sede, VALID_SEDE, 'sede');
    if ('error' in sedeResult) return sedeResult;
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
    return errorResponse('UNIQUE_CONSTRAINT', `Ya existe una unidad móvil con ${target}`, 409);
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
    const unidadIdFromPath = parseUnitIdFromPath(path);

    if (method === 'GET' && !unidadIdFromPath) {
      const units = await prisma.unidades_moviles.findMany({
        orderBy: [{ name: 'asc' }, { matricula: 'asc' }],
      });
      return successResponse({
        mobileUnits: units.map((unit: MobileUnitRecord) => normalizeMobileUnit(unit)),
      });
    }

    if (method === 'GET' && unidadIdFromPath) {
      const unit = await prisma.unidades_moviles.findUnique({
        where: { unidad_id: unidadIdFromPath },
      });
      if (!unit) {
        return errorResponse('NOT_FOUND', 'Unidad móvil no encontrada', 404);
      }
      return successResponse({ mobileUnit: normalizeMobileUnit(unit as MobileUnitRecord) });
    }

    if (method === 'POST') {
      if (!event.body) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }
      const body = JSON.parse(event.body || '{}');
      const result = buildCreateData(body);
      if ('error' in result) return result.error;

      const created = await prisma.unidades_moviles.create({ data: result.data });
      return successResponse({ mobileUnit: normalizeMobileUnit(created) }, 201);
    }

    if (method === 'PATCH' && unidadIdFromPath) {
      if (!event.body) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }

      const existing = await prisma.unidades_moviles.findUnique({ where: { unidad_id: unidadIdFromPath } });
      if (!existing) {
        return errorResponse('NOT_FOUND', 'Unidad móvil no encontrada', 404);
      }

      const body = JSON.parse(event.body || '{}');
      const result = buildUpdateData(body);
      if ('error' in result) return result.error;

      const updated = await prisma.unidades_moviles.update({
        where: { unidad_id: unidadIdFromPath },
        data: result.data,
      });

      return successResponse({ mobileUnit: normalizeMobileUnit(updated) });
    }

    return errorResponse('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (error: unknown) {
    const handled = handleKnownPrismaError(error);
    if (handled) return handled;

    const message = error instanceof Error ? error.message : 'Error inesperado';
    return errorResponse('UNEXPECTED_ERROR', message, 500);
  }
};
