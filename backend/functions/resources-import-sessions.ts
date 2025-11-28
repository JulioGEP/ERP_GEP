// backend/functions/resources-import-sessions.ts
import type { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';

import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { normalizeRoleKey, requireAuth } from './_shared/auth';

type SessionEstado = 'BORRADOR' | 'PLANIFICADA' | 'SUSPENDIDA' | 'CANCELADA' | 'FINALIZADA';

type SessionImportRow = {
  deal_id: string | null;
  deal_product_id: string | null;
  curso_name: string | null;
  nombre_cache: string | null;
  fecha_inicio_utc: Date | null;
  fecha_fin_utc: Date | null;
  estado: SessionEstado;
  trainer_id: string | null;
  direccion: string;
  unidad_movil_id: string | null;
};

const ALLOWED_ROLES = new Set(['admin', 'administracion', 'logistica', 'people']);
const SESSION_STATES = new Set<SessionEstado>([
  'BORRADOR',
  'PLANIFICADA',
  'SUSPENDIDA',
  'CANCELADA',
  'FINALIZADA',
]);

function toTrimmed(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function decodeBase64File(value: unknown): Buffer | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized.length) return null;
  try {
    return Buffer.from(normalized, 'base64');
  } catch (error) {
    console.error('[resources-import-sessions] Invalid base64 content', error);
    return null;
  }
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === 'number') {
    const dateFromNumber = new Date(value);
    return Number.isFinite(dateFromNumber.getTime()) ? dateFromNumber : null;
  }

  const asString = String(value).trim();
  if (!asString.length) return null;

  const dateFromString = new Date(asString);
  return Number.isFinite(dateFromString.getTime()) ? dateFromString : null;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function similarityScore(reference: string, candidate: string): number {
  const normalizedReference = normalizeText(reference);
  const normalizedCandidate = normalizeText(candidate);

  if (!normalizedReference.length || !normalizedCandidate.length) return 0;

  const distance = levenshteinDistance(normalizedReference, normalizedCandidate);
  return 1 - distance / Math.max(normalizedReference.length, normalizedCandidate.length);
}

function findProductByCourseName(
  courseName: string | null,
  products: Array<{ id: string; deal_id: string | null; name: string | null }>,
): string | null {
  if (!courseName) return null;

  let bestMatch: { id: string | null; score: number } = { id: null, score: 0 };

  for (const product of products) {
    if (!product.name) continue;
    const score = similarityScore(courseName, product.name);
    if (score > bestMatch.score) {
      bestMatch = { id: product.id, score };
    }
  }

  return bestMatch.score >= 0.75 ? bestMatch.id : null;
}

function normalizeEstado(value: unknown): SessionEstado | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized.length) return null;
  if (SESSION_STATES.has(normalized as SessionEstado)) {
    return normalized as SessionEstado;
  }
  return null;
}

function mapRawRow(row: Record<string, unknown>): SessionImportRow {
  const dealId = toTrimmed(row.deal_id ?? row.dealId);
  const dealProductId = toTrimmed(row.deal_product_id ?? row.deal_product_id ?? row.dealProductId);
  const cursoName = toTrimmed(row.curso_name ?? row.cursoName ?? row.course_name ?? row.courseName);
  const nombreCache = toTrimmed(row.nombre_cache ?? row.nombreCache ?? row.nombre);
  const direccion = toTrimmed(row.direccion ?? row.address) ?? '';
  const unidadMovilId = toTrimmed(row.unidad_movil ?? row.unidad_movil_id ?? row.unidadMovilId);
  const estado = normalizeEstado(row.estado) ?? 'BORRADOR';

  return {
    deal_id: dealId,
    deal_product_id: dealProductId,
    curso_name: cursoName,
    nombre_cache: nombreCache,
    fecha_inicio_utc: parseDate(row.fecha_inicio_utc ?? row.fecha_inicio ?? row.start_date),
    fecha_fin_utc: parseDate(row.fecha_fin_utc ?? row.fecha_fin ?? row.end_date),
    estado,
    trainer_id: toTrimmed(row.trainer_id ?? row.trainerId),
    direccion,
    unidad_movil_id: unidadMovilId,
  };
}

export const handler = createHttpHandler<any>(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma);

  if ('error' in auth) {
    return auth.error;
  }

  const role = normalizeRoleKey(auth.user.role);
  if (!role || !ALLOWED_ROLES.has(role)) {
    return errorResponse('FORBIDDEN', 'No tienes permisos para importar sesiones', 403);
  }

  const payload = (request.body && typeof request.body === 'object' ? request.body : {}) as any;
  const base64Content =
    payload.fileBase64 ?? payload.file ?? payload.excelBase64 ?? payload.base64 ?? payload.data;

  const fileBuffer = decodeBase64File(base64Content);
  if (!fileBuffer) {
    return errorResponse(
      'VALIDATION_ERROR',
      'Debes enviar el Excel en base64 (fileBase64)',
      400,
    );
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  } catch (error) {
    console.error('[resources-import-sessions] No se pudo leer el Excel', { error });
    return errorResponse('INVALID_FILE', 'No se pudo leer el Excel proporcionado', 400);
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return errorResponse('INVALID_FILE', 'El Excel no contiene hojas', 400);
  }

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  if (!rawRows.length) {
    return errorResponse('VALIDATION_ERROR', 'El Excel no contiene filas de datos', 400);
  }

  const mappedRows = rawRows.map(mapRawRow);

  const uniqueDealIds = Array.from(
    new Set(mappedRows.map((row) => row.deal_id).filter((value): value is string => Boolean(value))),
  );
  const uniqueProductIds = Array.from(
    new Set(
      mappedRows
        .map((row) => row.deal_product_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const dealIdsMissingProduct = Array.from(
    new Set(
      mappedRows
        .filter((row) => !row.deal_product_id && row.deal_id)
        .map((row) => row.deal_id!)
        .filter(Boolean),
    ),
  );
  const uniqueTrainerIds = Array.from(
    new Set(mappedRows.map((row) => row.trainer_id).filter((value): value is string => Boolean(value))),
  );
  const uniqueUnidadMovilIds = Array.from(
    new Set(
      mappedRows.map((row) => row.unidad_movil_id).filter((value): value is string => Boolean(value)),
    ),
  );

  const [deals, dealProducts, trainers, unidadesMoviles, salas]: [
    Array<{ deal_id: string }>,
    Array<{ id: string; deal_id: string | null; name: string | null }>,
    Array<{ trainer_id: string }>,
    Array<{ unidad_id: string }>,
    Array<{ sala_id: string }>,
  ] = await Promise.all([
    prisma.deals.findMany({
      where: uniqueDealIds.length ? { deal_id: { in: uniqueDealIds } } : undefined,
      select: { deal_id: true },
    }),
    prisma.deal_products.findMany({
      where:
        uniqueProductIds.length || dealIdsMissingProduct.length
          ? {
              OR: [
                uniqueProductIds.length ? { id: { in: uniqueProductIds } } : undefined,
                dealIdsMissingProduct.length ? { deal_id: { in: dealIdsMissingProduct } } : undefined,
              ].filter(Boolean) as Prisma.Enumerable<Prisma.deal_productsWhereInput>,
            }
          : undefined,
      select: { id: true, deal_id: true, name: true },
    }),
    prisma.trainers.findMany({
      where: uniqueTrainerIds.length ? { trainer_id: { in: uniqueTrainerIds } } : undefined,
      select: { trainer_id: true },
    }),
    prisma.unidades_moviles.findMany({
      where: uniqueUnidadMovilIds.length ? { unidad_id: { in: uniqueUnidadMovilIds } } : undefined,
      select: { unidad_id: true },
    }),
    prisma.salas.findMany({ select: { sala_id: true } }),
  ]);

  const dealMap = new Map(deals.map((deal) => [deal.deal_id, deal]));
  const productMap = new Map(dealProducts.map((product) => [product.id, product]));
  const productByDealId = dealProducts.reduce((map, product) => {
    if (!product.deal_id) return map;
    const existing = map.get(product.deal_id) ?? [];
    existing.push(product);
    map.set(product.deal_id, existing);
    return map;
  }, new Map<string, Array<{ id: string; deal_id: string | null; name: string | null }>>());
  const trainerMap = new Map(trainers.map((trainer) => [trainer.trainer_id, trainer]));
  const unidadMovilMap = new Map(unidadesMoviles.map((unidad) => [unidad.unidad_id, unidad]));
  const salaIds = salas.map((sala) => sala.sala_id);

  const results: Array<{ row: number; sessionId?: string; error?: string }> = [];
  const randomSalaId = () => (salaIds.length ? salaIds[Math.floor(Math.random() * salaIds.length)] : null);

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    for (let index = 0; index < mappedRows.length; index += 1) {
      const rowNumber = index + 2; // Excel row (header assumed in row 1)
      const row = mappedRows[index];

      const errors: string[] = [];

      if (!row.deal_id) {
        errors.push('deal_id obligatorio');
      } else if (!dealMap.has(row.deal_id)) {
        errors.push('deal_id no existe');
      }

      let dealProductId = row.deal_product_id;
      if (!dealProductId && row.deal_id) {
        const productsForDeal = productByDealId.get(row.deal_id) ?? [];
        // If the deal only has one product, we can safely auto-assign it; otherwise the user must
        // specify which product applies to the session.
        if (productsForDeal.length === 1) {
          dealProductId = productsForDeal[0].id;
          row.deal_product_id = dealProductId;
        } else if (productsForDeal.length === 0) {
          errors.push('deal_product_id obligatorio: el deal no tiene productos configurados');
        } else {
          const matchedProductId = findProductByCourseName(row.curso_name, productsForDeal);
          if (matchedProductId) {
            dealProductId = matchedProductId;
            row.deal_product_id = matchedProductId;
          } else {
            errors.push(
              'deal_product_id obligatorio: el deal tiene múltiples productos, indica cuál usar',
            );
          }
        }
      }

      if (!dealProductId) {
        errors.push('deal_product_id obligatorio');
      } else {
        const product = productMap.get(dealProductId);
        if (!product) {
          errors.push('deal_product_id no existe');
        } else if (row.deal_id && product.deal_id && product.deal_id !== row.deal_id) {
          errors.push('deal_product_id no pertenece al deal indicado');
        }
      }

      if (!row.nombre_cache) {
        errors.push('nombre_cache obligatorio');
      }

      if (row.estado && !SESSION_STATES.has(row.estado)) {
        errors.push('estado inválido');
      }

      if (row.trainer_id && !trainerMap.has(row.trainer_id)) {
        errors.push('trainer_id no existe');
      }

      if (row.unidad_movil_id && !unidadMovilMap.has(row.unidad_movil_id)) {
        errors.push('unidad_movil no existe');
      }

      if (row.fecha_inicio_utc && row.fecha_fin_utc && row.fecha_inicio_utc > row.fecha_fin_utc) {
        errors.push('fecha_inicio_utc posterior a fecha_fin_utc');
      }

      if (errors.length) {
        const message = errors.join('; ');
        console.error('[resources-import-sessions] Error de validación', {
          row: rowNumber,
          rowData: row,
          message,
        });
        results.push({ row: rowNumber, error: message });
        continue;
      }

      try {
        const session = await tx.sesiones.create({
          data: {
            deal_id: row.deal_id!,
            deal_product_id: row.deal_product_id!,
            nombre_cache: row.nombre_cache!,
            fecha_inicio_utc: row.fecha_inicio_utc,
            fecha_fin_utc: row.fecha_fin_utc,
            sala_id: randomSalaId(),
            direccion: row.direccion,
            estado: row.estado,
            drive_url: null,
            comentarios: null,
            sesion_trainers: row.trainer_id
              ? {
                  create: { trainer_id: row.trainer_id },
                }
              : undefined,
            sesion_unidades: row.unidad_movil_id
              ? {
                  create: { unidad_movil_id: row.unidad_movil_id },
                }
              : undefined,
          },
        });

        results.push({ row: rowNumber, sessionId: session.id });
      } catch (error) {
        const message =
          error instanceof Error && error.message ? error.message : 'Error desconocido insertando la sesión';
        console.error('[resources-import-sessions] Error insertando sesión', {
          row: rowNumber,
          rowData: row,
          error,
        });
        results.push({ row: rowNumber, error: message });
      }
    }
  });

  const imported = results.filter((result) => !result.error).length;
  const failed = results.filter((result) => result.error).length;

  return successResponse({
    imported,
    failed,
    results,
  });
});
