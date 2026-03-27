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
    const createdByUserId = auth.user.id;
    await prisma.$executeRaw`
      INSERT INTO actuaciones_preventivos (
        presupuesto,
        cliente,
        persona_contacto,
        direccion_preventivo,
        bombero,
        fecha_ejercicio,
        turno,
        partes_trabajo,
        asistencias_sanitarias,
        observaciones,
        responsable,
        created_by_user_id
      )
      VALUES (
        ${presupuesto},
        ${cliente},
        ${personaContacto},
        ${direccionPreventivo},
        ${bombero},
        ${exerciseDate},
        ${turno},
        ${partesTrabajo},
        ${asistenciasSanitarias},
        ${observaciones},
        ${responsable},
        ${createdByUserId}
      )
    `;
    return successResponse({ message: 'Actuación preventiva guardada correctamente.' }, 201);
  } catch (error) {
    console.error('[actuaciones-preventivos] Error al guardar informe', error);
    return errorResponse('INTERNAL_ERROR', 'No se pudo guardar la actuación preventiva.', 500);
  }
});
