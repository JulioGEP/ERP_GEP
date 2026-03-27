import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { prisma } from './_lib/db';

type Body = {
  presupuesto?: string;
  cliente?: string;
  personaContacto?: string;
  direccionPreventivo?: string;
  bombero?: string;
  fechaEjercicio?: string;
  turno?: string;
  partesTrabajo?: number;
  asistenciasSanitarias?: number;
  observaciones?: string;
  responsable?: string;
};

type CreatorColumn =
  | 'created_by_user_id'
  | 'created_by_trainer_id'
  | 'created_by_bombero_id'
  | 'created_by_firefighter_id'
  | 'created_by_actor_id';

const CREATOR_COLUMN_CANDIDATES: readonly CreatorColumn[] = [
  'created_by_user_id',
  'created_by_trainer_id',
  'created_by_bombero_id',
  'created_by_firefighter_id',
  'created_by_actor_id',
];

function asRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function asInteger(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric < 0) return null;
  return Math.trunc(numeric);
}

function asOptionalUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(trimmed) ? trimmed : null;
}

async function getAvailableCreatorColumns(): Promise<Set<CreatorColumn>> {
  const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'actuaciones_preventivos'
      AND column_name IN (
        'created_by_user_id',
        'created_by_trainer_id',
        'created_by_bombero_id',
        'created_by_firefighter_id',
        'created_by_actor_id'
      )
  `;

  const found = new Set<CreatorColumn>();
  for (const row of rows) {
    if (CREATOR_COLUMN_CANDIDATES.includes(row.column_name as CreatorColumn)) {
      found.add(row.column_name as CreatorColumn);
    }
  }
  return found;
}

async function insertActuacionPreventiva(params: {
  presupuesto: string;
  cliente: string;
  personaContacto: string;
  direccionPreventivo: string;
  bombero: string;
  exerciseDate: Date;
  turno: string;
  partesTrabajo: number;
  asistenciasSanitarias: number;
  observaciones: string;
  responsable: string;
  role: string | null | undefined;
  actorId: string | null;
  forceNullUserId?: boolean;
}): Promise<void> {
  const {
    presupuesto,
    cliente,
    personaContacto,
    direccionPreventivo,
    bombero,
    exerciseDate,
    turno,
    partesTrabajo,
    asistenciasSanitarias,
    observaciones,
    responsable,
    role,
    actorId,
    forceNullUserId = false,
  } = params;

  const availableCreatorColumns = await getAvailableCreatorColumns();
  const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';
  const isTrainer = normalizedRole === 'formador';
  const isFirefighter = normalizedRole === 'bombero';

  const columnValues: Array<[string, string | number | Date | null]> = [
    ['presupuesto', presupuesto],
    ['cliente', cliente],
    ['persona_contacto', personaContacto],
    ['direccion_preventivo', direccionPreventivo],
    ['bombero', bombero],
    ['fecha_ejercicio', exerciseDate],
    ['turno', turno],
    ['partes_trabajo', partesTrabajo],
    ['asistencias_sanitarias', asistenciasSanitarias],
    ['observaciones', observaciones],
    ['responsable', responsable],
  ];

  if (availableCreatorColumns.has('created_by_user_id')) {
    columnValues.push(['created_by_user_id', forceNullUserId ? null : actorId]);
  }

  if (availableCreatorColumns.has('created_by_actor_id')) {
    columnValues.push(['created_by_actor_id', actorId]);
  }

  if (availableCreatorColumns.has('created_by_trainer_id')) {
    columnValues.push(['created_by_trainer_id', isTrainer ? actorId : null]);
  }

  if (availableCreatorColumns.has('created_by_bombero_id')) {
    columnValues.push(['created_by_bombero_id', isFirefighter ? actorId : null]);
  }

  if (availableCreatorColumns.has('created_by_firefighter_id')) {
    columnValues.push(['created_by_firefighter_id', isFirefighter ? actorId : null]);
  }

  const columnsSql = columnValues.map(([column]) => `"${column}"`).join(', ');
  const placeholdersSql = columnValues.map((_, index) => `$${index + 1}`).join(', ');
  const values = columnValues.map(([, value]) => value);

  const sql = `INSERT INTO actuaciones_preventivos (${columnsSql}) VALUES (${placeholdersSql})`;
  await prisma.$executeRawUnsafe(sql, ...values);
}

export const handler = createHttpHandler<Body>(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const auth = await requireAuth(request, prisma);
  if ('error' in auth) return auth.error;

  const presupuesto = asRequiredString(request.body?.presupuesto);
  const cliente = asRequiredString(request.body?.cliente);
  const personaContacto = asRequiredString(request.body?.personaContacto);
  const direccionPreventivo = asRequiredString(request.body?.direccionPreventivo);
  const bombero = asRequiredString(request.body?.bombero);
  const fechaEjercicio = asRequiredString(request.body?.fechaEjercicio);
  const turno = asRequiredString(request.body?.turno);
  const partesTrabajo = asInteger(request.body?.partesTrabajo);
  const asistenciasSanitarias = asInteger(request.body?.asistenciasSanitarias);
  const observaciones =
    typeof request.body?.observaciones === 'string' ? request.body.observaciones.trim() : '';
  const responsable = asRequiredString(request.body?.responsable);

  if (
    !presupuesto ||
    !cliente ||
    !personaContacto ||
    !direccionPreventivo ||
    !bombero ||
    !fechaEjercicio ||
    !turno ||
    partesTrabajo === null ||
    asistenciasSanitarias === null ||
    !responsable
  ) {
    return errorResponse('VALIDATION_ERROR', 'Faltan campos obligatorios del informe.', 400);
  }

  const exerciseDate = new Date(fechaEjercicio);
  if (Number.isNaN(exerciseDate.getTime())) {
    return errorResponse('VALIDATION_ERROR', 'La fecha de ejercicio no es válida.', 400);
  }

  try {
    const actorId = asOptionalUuid(auth.user.id);

    try {
      await insertActuacionPreventiva({
        presupuesto,
        cliente,
        personaContacto,
        direccionPreventivo,
        bombero,
        exerciseDate,
        turno,
        partesTrabajo,
        asistenciasSanitarias,
        observaciones,
        responsable,
        role: auth.user.role,
        actorId,
      });
    } catch (error) {
      const prismaErrorCode = (error as { code?: string } | null)?.code;
      if (prismaErrorCode === '23503' && actorId) {
        await insertActuacionPreventiva({
          presupuesto,
          cliente,
          personaContacto,
          direccionPreventivo,
          bombero,
          exerciseDate,
          turno,
          partesTrabajo,
          asistenciasSanitarias,
          observaciones,
          responsable,
          role: auth.user.role,
          actorId,
          forceNullUserId: true,
        });
      } else {
        throw error;
      }
    }

    return successResponse({ message: 'Actuación preventiva guardada correctamente.' }, 201);
  } catch (error) {
    console.error('[actuaciones-preventivos] Error al guardar informe', error);
    const prismaErrorCode = (error as { code?: string } | null)?.code;
    if (prismaErrorCode === '22P02' || prismaErrorCode === '23503') {
      return errorResponse(
        'VALIDATION_ERROR',
        'No se pudo asociar el usuario autenticado al informe. Vuelve a iniciar sesión e inténtalo de nuevo.',
        400,
      );
    }
    return errorResponse('INTERNAL_ERROR', 'No se pudo guardar la actuación preventiva.', 500);
  }
});
