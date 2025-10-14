// backend/functions/alumnos.ts
import { validate as isUUID } from 'uuid';
import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import { nowInMadridDate, toMadridISOString } from './_shared/timezone';

function parsePath(path: string) {
  const value = String(path || '');
  const match = value.match(/\/(?:\.netlify\/functions\/)?alumnos(?:\/([^/]+))?$/i);
  const studentId = match?.[1] ? decodeURIComponent(match[1]) : null;
  return { studentId };
}

function normalizeDealId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeDni(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toUpperCase().replace(/\s+/g, '');
  return trimmed.length ? trimmed : null;
}

function isValidDni(dni: string): boolean {
  return dni.length >= 7 && dni.length <= 12 && /^[A-Z0-9]+$/.test(dni);
}

function mapStudentForResponse(student: any) {
  if (!student) return student;
  return {
    id: typeof student.id === 'string' ? student.id : String(student.id ?? ''),
    deal_id: student.deal_id,
    sesion_id: student.sesion_id,
    nombre: student.nombre,
    apellido: student.apellido,
    dni: student.dni,
    apto: Boolean(student.apto),
    certificado: Boolean(student.certificado),
    created_at: toMadridISOString(student.created_at),
    updated_at: toMadridISOString(student.updated_at),
  };
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    const method = event.httpMethod ?? 'GET';
    const { studentId } = parsePath(event.path || '');
    const prisma = getPrisma();

    if (method === 'GET') {
      if (studentId) {
        return errorResponse('NOT_IMPLEMENTED', 'Consulta individual no soportada', 404);
      }

      const params = event.queryStringParameters || {};
      const dealId =
        normalizeDealId(params.deal_id) ||
        normalizeDealId(params.dealId) ||
        normalizeDealId(params.dealID);
      const sessionIdRaw =
        normalizeDealId(params.sesion_id) ||
        normalizeDealId(params.session_id) ||
        normalizeDealId(params.sessionId) ||
        normalizeDealId(params.sesionId);

      if (!dealId) {
        return errorResponse('VALIDATION_ERROR', 'deal_id requerido', 400);
      }
      if (!sessionIdRaw) {
        return errorResponse('VALIDATION_ERROR', 'sesion_id requerido', 400);
      }
      if (!isUUID(sessionIdRaw)) {
        return errorResponse('VALIDATION_ERROR', 'sesion_id inválido (UUID requerido)', 400);
      }

      const students = await prisma.alumnos.findMany({
        where: { deal_id: dealId, sesion_id: sessionIdRaw },
        orderBy: { created_at: 'desc' },
      });

      return successResponse({ students: students.map(mapStudentForResponse) });
    }

    if (method === 'POST' && !studentId) {
      if (!event.body) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }

      const payload = JSON.parse(event.body || '{}');
      const dealId = normalizeDealId(payload.deal_id);
      const sessionId = normalizeDealId(payload.sesion_id);
      const nombre = normalizeName(payload.nombre);
      const apellido = normalizeName(payload.apellido);
      const dni = normalizeDni(payload.dni);
      const apto = Boolean(payload.apto);
      const certificado = Boolean(payload.certificado);

      if (!dealId) {
        return errorResponse('VALIDATION_ERROR', 'deal_id requerido', 400);
      }
      if (!sessionId || !isUUID(sessionId)) {
        return errorResponse('VALIDATION_ERROR', 'sesion_id inválido (UUID requerido)', 400);
      }
      if (!nombre) {
        return errorResponse('VALIDATION_ERROR', 'nombre requerido', 400);
      }
      if (!apellido) {
        return errorResponse('VALIDATION_ERROR', 'apellido requerido', 400);
      }
      if (!dni || !isValidDni(dni)) {
        return errorResponse('VALIDATION_ERROR', 'dni inválido', 400);
      }

      const session = await prisma.sessions.findUnique({
        where: { id: sessionId },
        select: { id: true, deal_id: true },
      });
      if (!session || session.deal_id !== dealId) {
        return errorResponse('NOT_FOUND', 'Sesión no encontrada para el deal', 404);
      }

      const duplicate = await prisma.alumnos.findFirst({
        where: { sesion_id: sessionId, dni },
        select: { id: true },
      });
      if (duplicate) {
        return errorResponse('DUPLICATE_DNI', 'Ya existe un alumno con este DNI en la sesión', 409);
      }

      const now = nowInMadridDate();
      const created = await prisma.alumnos.create({
        data: {
          deal_id: dealId,
          sesion_id: sessionId,
          nombre,
          apellido,
          dni,
          apto,
          certificado,
          created_at: now,
          updated_at: now,
        },
      });

      return successResponse({ student: mapStudentForResponse(created) }, 201);
    }

    if (method === 'PATCH' && studentId) {
      if (!event.body) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }

      const studentIdTrimmed = studentId.trim();
      if (!studentIdTrimmed || !isUUID(studentIdTrimmed)) {
        return errorResponse('VALIDATION_ERROR', 'id de alumno inválido (UUID requerido)', 400);
      }

      const existing = await prisma.alumnos.findUnique({ where: { id: studentIdTrimmed } });
      if (!existing) {
        return errorResponse('NOT_FOUND', 'Alumno no encontrado', 404);
      }

      const payload = JSON.parse(event.body || '{}');
      const nombre =
        payload.nombre === undefined ? undefined : normalizeName(payload.nombre);
      const apellido =
        payload.apellido === undefined ? undefined : normalizeName(payload.apellido);
      const dni = payload.dni === undefined ? undefined : normalizeDni(payload.dni);
      const apto = payload.apto === undefined ? undefined : Boolean(payload.apto);
      const certificado =
        payload.certificado === undefined ? undefined : Boolean(payload.certificado);

      const data: Record<string, any> = {};

      if (nombre !== undefined) {
        if (!nombre) {
          return errorResponse('VALIDATION_ERROR', 'nombre requerido', 400);
        }
        data.nombre = nombre;
      }

      if (apellido !== undefined) {
        if (!apellido) {
          return errorResponse('VALIDATION_ERROR', 'apellido requerido', 400);
        }
        data.apellido = apellido;
      }

      if (dni !== undefined) {
        if (!dni || !isValidDni(dni)) {
          return errorResponse('VALIDATION_ERROR', 'dni inválido', 400);
        }
        const duplicate = await prisma.alumnos.findFirst({
          where: {
            sesion_id: existing.sesion_id,
            dni,
            NOT: { id: studentIdTrimmed },
          },
          select: { id: true },
        });
        if (duplicate) {
          return errorResponse('DUPLICATE_DNI', 'Ya existe un alumno con este DNI en la sesión', 409);
        }
        data.dni = dni;
      }

      if (apto !== undefined) {
        data.apto = apto;
      }

      if (certificado !== undefined) {
        data.certificado = certificado;
      }

      if (!Object.keys(data).length) {
        return successResponse({ student: mapStudentForResponse(existing) });
      }

      const updated = await prisma.alumnos.update({
        where: { id: studentIdTrimmed },
        data,
      });

      return successResponse({ student: mapStudentForResponse(updated) });
    }

    if (method === 'DELETE' && studentId) {
      const studentIdTrimmed = studentId.trim();
      if (!studentIdTrimmed || !isUUID(studentIdTrimmed)) {
        return errorResponse('VALIDATION_ERROR', 'id de alumno inválido (UUID requerido)', 400);
      }

      const existing = await prisma.alumnos.findUnique({ where: { id: studentIdTrimmed } });
      if (!existing) {
        return errorResponse('NOT_FOUND', 'Alumno no encontrado', 404);
      }

      await prisma.alumnos.delete({ where: { id: studentIdTrimmed } });

      return successResponse({ deleted: true });
    }

    return errorResponse('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (error: any) {
    const message = error?.message || 'Unexpected error';
    return errorResponse('UNEXPECTED', message, 500);
  }
};
