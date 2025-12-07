// backend/functions/public-session-students.ts
import { validate as isUUID } from 'uuid';
import { getPrisma } from './_shared/prisma';
import { normalizeDriveUrl } from './_shared/drive';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import { nowInMadridDate, toMadridISOString } from './_shared/timezone';

const RATE_LIMIT_WINDOW_MS = Number(process.env.PUBLIC_SESSION_RATE_LIMIT_WINDOW_MS ?? 60_000);
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.PUBLIC_SESSION_RATE_LIMIT_MAX_REQUESTS ?? 120);

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  return isUUID(trimmed) ? trimmed : null;
}

function normalizeDni(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toUpperCase().replace(/\s+/g, '');
  return trimmed.length ? trimmed : null;
}

function isValidDni(dni: string): boolean {
  return dni.length >= 7 && dni.length <= 12 && /^[A-Z0-9]+$/.test(dni);
}

function parsePath(path: string): { studentId: string | null } {
  const match = String(path || '').match(/\/(?:\.netlify\/functions\/)?public-session-students(?:\/([^/]+))?$/i);
  const studentId = match?.[1] ? decodeURIComponent(match[1]) : null;
  return { studentId };
}

function readHeader(headers: Record<string, unknown>, name: string): string | null {
  const direct = headers[name];
  if (typeof direct === 'string' && direct.trim().length) return direct;
  const lower = name.toLowerCase();
  const lowerValue = headers[lower];
  if (typeof lowerValue === 'string' && lowerValue.trim().length) return lowerValue;
  const upper = name.toUpperCase();
  const upperValue = headers[upper];
  if (typeof upperValue === 'string' && upperValue.trim().length) return upperValue;
  for (const key of Object.keys(headers || {})) {
    if (key.toLowerCase() === lower) {
      const value = headers[key];
      if (typeof value === 'string' && value.trim().length) return value;
    }
  }
  return null;
}

function extractClientIp(event: any): string | null {
  const headers = event?.headers ?? {};
  const forwarded = readHeader(headers, 'x-forwarded-for');
  if (forwarded) {
    const ip = forwarded.split(',')[0]?.trim();
    if (ip) return ip;
  }
  const netlifyIp = readHeader(headers, 'x-nf-client-connection-ip');
  if (netlifyIp && netlifyIp.trim().length) return netlifyIp.trim();
  const realIp = readHeader(headers, 'x-real-ip');
  if (realIp && realIp.trim().length) return realIp.trim();
  const clientIp = readHeader(headers, 'client-ip');
  if (clientIp && clientIp.trim().length) return clientIp.trim();
  return null;
}

function extractUserAgent(event: any): string | null {
  const headers = event?.headers ?? {};
  const ua = readHeader(headers, 'user-agent');
  return ua ? ua.trim() : null;
}

function consumeRateLimit(token: string, ip: string | null): boolean {
  if (!RATE_LIMIT_WINDOW_MS || RATE_LIMIT_WINDOW_MS <= 0 || !RATE_LIMIT_MAX_REQUESTS || RATE_LIMIT_MAX_REQUESTS <= 0) {
    return true;
  }
  const key = `${token}|${ip ?? 'unknown'}`;
  const now = Date.now();
  let bucket = rateLimitBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  }
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);
  return bucket.count <= RATE_LIMIT_MAX_REQUESTS;
}

function mapStudent(student: any) {
  if (!student) return student;
  return {
    id: String(student.id ?? ''),
    deal_id: normalizeId(student.deal_id),
    sesion_id: normalizeUuid(student.sesion_id) ?? normalizeId(student.sesion_id),
    nombre: student.nombre,
    apellido: student.apellido,
    dni: student.dni,
    apto: Boolean(student.apto),
    certificado: Boolean(student.certificado),
    drive_url: normalizeDriveUrl(student.drive_url),
    created_at: toMadridISOString(student.created_at),
    updated_at: toMadridISOString(student.updated_at),
  };
}

function mapSessionInfo(link: any) {
  const s = link?.sesiones ?? {};
  const d = s?.deals ?? {};
  const dealId = normalizeId(s?.deal_id) ?? normalizeId(d?.deal_id);

  const formation =
    s?.deal_products?.name?.trim()?.length
      ? s.deal_products.name
      : s?.deal_products?.code?.trim()?.length
        ? s.deal_products.code
        : null;

  const sessionAddress = (() => {
    if (typeof s?.direccion === 'string' && s.direccion.trim().length) return s.direccion;
    if (typeof d?.training_address === 'string' && d.training_address.trim().length) {
      return d.training_address;
    }
    return null;
  })();

  return {
    deal_id: dealId,
    sesion_id: s?.id ?? null,
    session_name: s?.nombre_cache ?? null,
    formation_name: formation,
    title: d?.title ?? null,
    organization_name: d?.organizations?.name ?? null,
    comercial: d?.comercial ?? null,
    session_address: sessionAddress,
  };
}

// Deja que TS infiera el tipo correcto (Promise<... | null>) sin usar tokensGetPayload (eliminado en Prisma v5)
async function resolveLink(prisma: ReturnType<typeof getPrisma>, token: string) {
  if (!token.trim().length) return null;
  return prisma.tokens.findUnique({
    where: { token },
    include: {
      sesiones: {
        select: {
          id: true,
          deal_id: true,
          nombre_cache: true,
          fecha_fin_utc: true,
          direccion: true,
          deal_products: { select: { id: true, name: true, code: true } },
          deals: {
            select: {
              deal_id: true,
              title: true,
              comercial: true,
              training_address: true,
              organizations: { select: { name: true } },
            },
          },
        },
      },
    },
  });
}

async function ensureValidLink(prisma: ReturnType<typeof getPrisma>, token: string) {
  const link = await resolveLink(prisma, token);
  if (!link) {
    return { error: errorResponse('TOKEN_INVALID', 'Enlace inválido', 404) } as const;
  }
  const now = new Date();
  const sessionEnd = link.sesiones?.fecha_fin_utc instanceof Date ? link.sesiones.fecha_fin_utc : null;
  if (!link.active) {
    return { error: errorResponse('TOKEN_REVOKED', 'Este enlace ha sido desactivado', 410) } as const;
  }
  if (sessionEnd && now >= sessionEnd) {
    return { error: errorResponse('TOKEN_EXPIRED', 'Este enlace ha expirado', 410) } as const;
  }
  if (link.expires_at && now >= link.expires_at) {
    return { error: errorResponse('TOKEN_EXPIRED', 'Este enlace ha expirado', 410) } as const;
  }
  return { link } as const;
}

function logAudit(event: any, link: any, action: string, details: Record<string, unknown> = {}) {
  const payload = {
    scope: 'public-session-students',
    action,
    link_id: link?.id ?? null,
    sesion_id: link?.sesion_id ?? link?.session?.id ?? null,
    deal_id: link?.session?.deal_id ?? link?.session?.deals?.deal_id ?? null,
    token_suffix: typeof link?.token === 'string' ? link.token.slice(-6) : null,
    ip: extractClientIp(event),
    user_agent: extractUserAgent(event),
    details,
  };
  console.info(JSON.stringify(payload));
}

function normalizeToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    const { studentId } = parsePath(event.path || '');
    const method = event.httpMethod ?? 'GET';
    const prisma = getPrisma();
    const headers = event.headers || {};

    const tokenParam = event.queryStringParameters?.token ?? event.queryStringParameters?.Token;
    const tokenFromBody = (() => {
      if (!event.body) return null;
      try {
        const parsed = JSON.parse(event.body);
        return parsed?.token ?? null;
      } catch {
        return null;
      }
    })();

    const token = normalizeToken(tokenParam ?? tokenFromBody);

    if (!token) {
      return errorResponse('TOKEN_REQUIRED', 'token requerido', 400);
    }

    const ip = extractClientIp(event);
    if (!consumeRateLimit(token, ip)) {
      return errorResponse('RATE_LIMITED', 'Demasiadas peticiones, espera unos segundos', 429);
    }

    const validation = await ensureValidLink(prisma, token);
    if ('error' in validation) {
      logAudit(event, null, 'token_invalid', { token_suffix: token.slice(-6) });
      return validation.error;
    }

    const { link } = validation;
    const sessionDealId =
    normalizeId(link.sesiones?.deal_id) ?? normalizeId(link.sesiones?.deals?.deal_id);
    const sessionIdForStudents =
  normalizeUuid(link.session_id) ??
  normalizeUuid(link.sesiones?.id) ??
  normalizeId(link.sesiones?.id);

    if (!sessionIdForStudents) {
      logAudit(event, link, 'session_missing');
      return errorResponse('TOKEN_INVALID', 'Sesión no disponible para este enlace', 404);
    }

    if (method === 'GET') {
      logAudit(event, link, 'list');
      const students = await prisma.alumnos.findMany({
        where: { sesion_id: sessionIdForStudents },
        orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
      });
      return successResponse({
        session: mapSessionInfo(link),
        students: students.map(mapStudent),
      });
    }

    if (method === 'POST' && !studentId) {
      if (!event.body) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }

      let payload: any = {};
      try {
        payload = JSON.parse(event.body || '{}');
      } catch {
        return errorResponse('VALIDATION_ERROR', 'Body JSON inválido', 400);
      }

      const nombre = normalizeText(payload.nombre);
      const apellido = normalizeText(payload.apellido);
      const dni = normalizeDni(payload.dni);

      if (!nombre || !apellido || !dni) {
        return errorResponse('VALIDATION_ERROR', 'Nombre, apellidos y DNI son obligatorios', 400);
      }
      if (!isValidDni(dni)) {
        return errorResponse('VALIDATION_ERROR', 'dni inválido', 400);
      }

      const duplicate = await prisma.alumnos.findFirst({
        where: { sesion_id: sessionIdForStudents, dni },
        select: { id: true },
      });
      if (duplicate) {
        return errorResponse('DUPLICATE_DNI', 'Este DNI ya existe en esta sesión', 409);
      }

      if (!sessionDealId) {
        return errorResponse('TOKEN_INVALID', 'La sesión vinculada al enlace no es válida', 409);
      }

      const now = nowInMadridDate();
      const created = await prisma.alumnos.create({
        data: {
          deal_id: sessionDealId,
          sesion_id: sessionIdForStudents,
          nombre,
          apellido,
          dni,
          apto: false,
          certificado: false,
          created_at: now,
          updated_at: now,
        },
      });

      logAudit(event, link, 'create', { student_id: created.id });
      return successResponse({ student: mapStudent(created) }, 201);
    }

    if (method === 'PATCH' && studentId) {
      const studentIdTrimmed = studentId.trim();
      if (!studentIdTrimmed || !isUUID(studentIdTrimmed)) {
        return errorResponse('VALIDATION_ERROR', 'id de alumno inválido (UUID requerido)', 400);
      }

      if (!event.body) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }

      let payload: any = {};
      try {
        payload = JSON.parse(event.body || '{}');
      } catch {
        return errorResponse('VALIDATION_ERROR', 'Body JSON inválido', 400);
      }

      const existing = await prisma.alumnos.findFirst({
        where: { id: studentIdTrimmed, sesion_id: sessionIdForStudents },
      });

      if (!existing) {
        return errorResponse('NOT_FOUND', 'Alumno no encontrado', 404);
      }

      const nombre = payload.nombre === undefined ? undefined : normalizeText(payload.nombre);
      const apellido = payload.apellido === undefined ? undefined : normalizeText(payload.apellido);
      const dni = payload.dni === undefined ? undefined : normalizeDni(payload.dni);

      // Usamos tipo estructural para evitar choques con tipos generados cambiantes en Prisma v5
      const data: any = {};

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
            sesion_id: sessionIdForStudents,
            dni,
            NOT: { id: studentIdTrimmed },
          },
          select: { id: true },
        });
        if (duplicate) {
          return errorResponse('DUPLICATE_DNI', 'Este DNI ya existe en esta sesión', 409);
        }
        data.dni = dni;
      }

      if (Object.keys(data).length === 0) {
        return successResponse({ student: mapStudent(existing) });
      }

      const updated = await prisma.alumnos.update({
        where: { id: studentIdTrimmed },
        data,
      });

      logAudit(event, link, 'update', { student_id: updated.id });
      return successResponse({ student: mapStudent(updated) });
    }

    if (method === 'DELETE' && studentId) {
      const studentIdTrimmed = studentId.trim();
      if (!studentIdTrimmed || !isUUID(studentIdTrimmed)) {
        return errorResponse('VALIDATION_ERROR', 'id de alumno inválido (UUID requerido)', 400);
      }

      const existing = await prisma.alumnos.findFirst({
        where: { id: studentIdTrimmed, sesion_id: sessionIdForStudents },
        select: { id: true },
      });

      if (!existing) {
        return errorResponse('NOT_FOUND', 'Alumno no encontrado', 404);
      }

      await prisma.alumnos.delete({ where: { id: studentIdTrimmed } });

      logAudit(event, link, 'delete', { student_id: studentIdTrimmed });
      return successResponse({ deleted: true });
    }

    return errorResponse('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (error: any) {
    const message = error?.message || 'Unexpected error';
    console.error('public-session-students error', error);
    return errorResponse('UNEXPECTED', message, 500);
  }
};
