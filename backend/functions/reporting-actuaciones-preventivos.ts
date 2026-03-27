import { Prisma } from '@prisma/client';
import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { toMadridISOString } from './_shared/timezone';

type RawMonthlyKpiRow = {
  month_start: Date;
  informes_count: number;
  partes_trabajo: number;
  asistencias_sanitarias: number;
  actividad_total: number;
  dias_con_actividad: number;
};

type RawLogRow = {
  id: string;
  presupuesto: string;
  cliente: string;
  persona_contacto: string;
  direccion_preventivo: string;
  bombero: string;
  fecha_ejercicio: Date;
  turno: string;
  partes_trabajo: number;
  asistencias_sanitarias: number;
  actividad_total: number;
  observaciones: string;
  responsable: string;
  created_at: Date;
};

function parseDateParam(raw: string | undefined): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;

  const date = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toEndExclusive(date: Date | null): Date | null {
  if (!date) return null;
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ['Admin'] });
  if ('error' in auth) return auth.error;

  const startDate = parseDateParam(request.query.startDate);
  const endDateInclusive = parseDateParam(request.query.endDate);

  if (request.query.startDate && !startDate) {
    return errorResponse('VALIDATION_ERROR', 'startDate debe tener formato YYYY-MM-DD.', 400);
  }

  if (request.query.endDate && !endDateInclusive) {
    return errorResponse('VALIDATION_ERROR', 'endDate debe tener formato YYYY-MM-DD.', 400);
  }

  const endDateExclusive = toEndExclusive(endDateInclusive);
  if (startDate && endDateExclusive && startDate >= endDateExclusive) {
    return errorResponse('VALIDATION_ERROR', 'El rango de fechas no es válido.', 400);
  }

  const whereSql = Prisma.sql`
    WHERE (${startDate}::timestamptz IS NULL OR fecha_ejercicio >= ${startDate})
      AND (${endDateExclusive}::timestamptz IS NULL OR fecha_ejercicio < ${endDateExclusive})
  `;

  const [kpiRows, logRows] = await Promise.all([
    prisma.$queryRaw<RawMonthlyKpiRow[]>(Prisma.sql`
      SELECT
        date_trunc('month', fecha_ejercicio AT TIME ZONE 'Europe/Madrid')::date AS month_start,
        COUNT(*)::int AS informes_count,
        COALESCE(SUM(partes_trabajo), 0)::int AS partes_trabajo,
        COALESCE(SUM(asistencias_sanitarias), 0)::int AS asistencias_sanitarias,
        COALESCE(SUM(partes_trabajo + asistencias_sanitarias), 0)::int AS actividad_total,
        COUNT(DISTINCT (fecha_ejercicio AT TIME ZONE 'Europe/Madrid')::date)::int AS dias_con_actividad
      FROM actuaciones_preventivos
      ${whereSql}
      GROUP BY 1
      ORDER BY 1 DESC
    `),
    prisma.$queryRaw<RawLogRow[]>(Prisma.sql`
      SELECT
        id,
        presupuesto,
        cliente,
        persona_contacto,
        direccion_preventivo,
        bombero,
        fecha_ejercicio,
        turno,
        partes_trabajo,
        asistencias_sanitarias,
        (partes_trabajo + asistencias_sanitarias)::int AS actividad_total,
        observaciones,
        responsable,
        created_at
      FROM actuaciones_preventivos
      ${whereSql}
      ORDER BY fecha_ejercicio DESC, created_at DESC
      LIMIT 2000
    `),
  ]);

  const monthlyKpis = kpiRows.map((row) => ({
    month: row.month_start.toISOString().slice(0, 7),
    informesCount: Number(row.informes_count ?? 0),
    partesTrabajo: Number(row.partes_trabajo ?? 0),
    asistenciasSanitarias: Number(row.asistencias_sanitarias ?? 0),
    actividadTotal: Number(row.actividad_total ?? 0),
    diasConActividad: Number(row.dias_con_actividad ?? 0),
    promedioActividadDia:
      Number(row.dias_con_actividad ?? 0) > 0
        ? Number(row.actividad_total ?? 0) / Number(row.dias_con_actividad)
        : 0,
  }));

  const logs = logRows.map((row) => ({
    id: row.id,
    presupuesto: row.presupuesto,
    cliente: row.cliente,
    personaContacto: row.persona_contacto,
    direccionPreventivo: row.direccion_preventivo,
    bombero: row.bombero,
    fechaEjercicio: toMadridISOString(row.fecha_ejercicio),
    turno: row.turno,
    partesTrabajo: Number(row.partes_trabajo ?? 0),
    asistenciasSanitarias: Number(row.asistencias_sanitarias ?? 0),
    actividadTotal: Number(row.actividad_total ?? 0),
    observaciones: row.observaciones,
    responsable: row.responsable,
    createdAt: toMadridISOString(row.created_at),
  }));

  return successResponse({ monthlyKpis, logs });
});
