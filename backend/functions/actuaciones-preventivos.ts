import { requireAuth } from './_shared/auth';
import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';

const METHOD_NOT_ALLOWED = errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);

const ALLOWED_TURNO_VALUES = ['Mañana', 'Noche'] as const;

const trimToNull = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length ? normalized : null;
};

const parseOptionalInteger = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
};

const parseRequiredDate = (value: unknown): Date | null => {
  if (typeof value !== 'string' || !value.trim().length) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const handler = createHttpHandler<any>(async (request) => {
  if (request.method === 'GET') {
    const prisma = getPrisma();
    const auth = await requireAuth(request, prisma);
    if ('error' in auth) {
      return auth.error;
    }

    const startDateParam = request.queryStringParameters?.startDate;
    const endDateParam = request.queryStringParameters?.endDate;

    const startDate = startDateParam ? new Date(startDateParam) : null;
    if (startDateParam && (startDate === null || Number.isNaN(startDate.getTime()))) {
      return errorResponse('VALIDATION_ERROR', 'El campo startDate no es válido.', 400);
    }

    const endDate = endDateParam ? new Date(endDateParam) : null;
    if (endDateParam && (endDate === null || Number.isNaN(endDate.getTime()))) {
      return errorResponse('VALIDATION_ERROR', 'El campo endDate no es válido.', 400);
    }

    const records = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
        SELECT
          id,
          deal_id,
          cliente,
          persona_contacto,
          direccion_preventivo,
          bombero,
          fecha_ejercicio,
          turno,
          partes_trabajo,
          asistencias_sanitarias,
          derivaron_mutua,
          observaciones,
          responsable,
          created_by_user_id,
          created_at,
          updated_at
        FROM actuaciones_preventivos_informes
        WHERE ($1::timestamptz IS NULL OR fecha_ejercicio >= $1::timestamptz)
          AND ($2::timestamptz IS NULL OR fecha_ejercicio <= $2::timestamptz)
        ORDER BY fecha_ejercicio DESC, created_at DESC
      `,
      startDate,
      endDate,
    );

    return successResponse({ informes: records });
  }

  if (request.method !== 'POST') {
    return METHOD_NOT_ALLOWED;
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma);
  if ('error' in auth) {
    return auth.error;
  }

  const body = request.body && typeof request.body === 'object' ? request.body : {};

  const dealId = trimToNull(body.dealId ?? body.presupuesto);
  if (!dealId) {
    return errorResponse('VALIDATION_ERROR', 'El campo presupuesto/dealId es obligatorio.', 400);
  }

  const fechaEjercicio = parseRequiredDate(body.fechaEjercicio);
  if (!fechaEjercicio) {
    return errorResponse('VALIDATION_ERROR', 'El campo fechaEjercicio es obligatorio.', 400);
  }

  const partesTrabajo = parseOptionalInteger(body.partesTrabajo);
  if (body.partesTrabajo !== null && body.partesTrabajo !== undefined && body.partesTrabajo !== '' && partesTrabajo === null) {
    return errorResponse('VALIDATION_ERROR', 'El campo partesTrabajo debe ser numérico y mayor o igual que 0.', 400);
  }

  const asistenciasSanitarias = parseOptionalInteger(body.asistenciasSanitarias);
  if (
    body.asistenciasSanitarias !== null &&
    body.asistenciasSanitarias !== undefined &&
    body.asistenciasSanitarias !== '' &&
    asistenciasSanitarias === null
  ) {
    return errorResponse('VALIDATION_ERROR', 'El campo asistenciasSanitarias debe ser numérico y mayor o igual que 0.', 400);
  }

  const derivaronMutua = parseOptionalInteger(body.derivaronMutua);
  if (
    body.derivaronMutua !== null &&
    body.derivaronMutua !== undefined &&
    body.derivaronMutua !== '' &&
    derivaronMutua === null
  ) {
    return errorResponse('VALIDATION_ERROR', 'El campo derivaronMutua debe ser numérico y mayor o igual que 0.', 400);
  }

  const turno = trimToNull(body.turno) ?? 'Mañana';
  if (!ALLOWED_TURNO_VALUES.includes(turno as (typeof ALLOWED_TURNO_VALUES)[number])) {
    return errorResponse('VALIDATION_ERROR', 'El campo turno debe ser Mañana o Noche.', 400);
  }

  const creatorName = [auth.user.first_name, auth.user.last_name].filter(Boolean).join(' ').trim() || auth.user.email;

  const record: any = await prisma.$queryRawUnsafe(
    `
      INSERT INTO actuaciones_preventivos_informes (
        deal_id,
        cliente,
        persona_contacto,
        direccion_preventivo,
        bombero,
        fecha_ejercicio,
        turno,
        partes_trabajo,
        asistencias_sanitarias,
        derivaron_mutua,
        observaciones,
        responsable,
        created_by_user_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
      )
      RETURNING
        id,
        deal_id,
        cliente,
        persona_contacto,
        direccion_preventivo,
        bombero,
        fecha_ejercicio,
        turno,
        partes_trabajo,
        asistencias_sanitarias,
        derivaron_mutua,
        observaciones,
        responsable,
        created_by_user_id,
        created_at,
        updated_at
    `,
    dealId,
    trimToNull(body.cliente),
    trimToNull(body.personaContacto),
    trimToNull(body.direccionPreventivo),
    creatorName,
    fechaEjercicio,
    turno,
    partesTrabajo,
    asistenciasSanitarias,
    derivaronMutua,
    trimToNull(body.observaciones),
    trimToNull(body.responsable),
    auth.user.id,
  );

  return successResponse({ informe: Array.isArray(record) ? record[0] : record }, 201);
});

export default handler;
