// backend/functions/public-session-students.ts
import { validate as isUUID } from 'uuid';
import type { Prisma } from '@prisma/client';
import { getPrisma } from './_shared/prisma';
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
    nombre: student.nombre,
    apellido: student.apellido,
    dni: student.dni,
    apto: Boolean(student.apto),
    certificado: Boolean(student.certificado),
    created_at: toMadridISOString(student.created_at),
    updated_at: toMadridISOString(student.updated_at),
  };
}

function mapSessionInfo(link: any) {
  const dealId = link?.deal_id ?? link?.deal?.deal_id ?? null;
  const session = link?.session ?? {};
  const formation =
    session?.deal_product?.name?.trim()?.length
      ? session.deal_product.name
      : session?.deal_product?.code?.trim()?.length
        ? session.deal_product.code
        : null;
  return {
    deal_id: dealId,
    sesion_id: session?.id ?? null,
    session_name: session?.nombre_cache ?? null,
    formation_name: formation,
    title: link?.deal?.title ?? null,
  };
}

async function resolveLink(
  prisma: ReturnType<typeof getPrisma>,
  token: string,
): Promise<Prisma.session_public_linksGetPayload<{ include: { session: { select: { id: true; deal_id: true; nombre_cache: true; deal_product: { select: { id: true; name: true; code: true } } } }; deal: { select: { deal_id: true; title: true } } } }> | null> {
  if (!token.trim().length) return null;
  return prisma.session_public_links.findUnique({
    where: { token },
    include: {
      session: {
        select: {
          id: true,
          deal_id: true,
          nombre_cache: true,
          deal_product: { select: { id: true, name: true, code: true } },
        },
      },
      deal: { select: { deal_id: true, title: true } },
    },
  });
}

async function ensureValidLink(prisma: ReturnType<typeof getPrisma>, token: string) {
  const link = await resolveLink(prisma, token);
  if (!link) {
    return { error: errorResponse('TOKEN_INVALID', 'Enlace inválido', 404) } as const;
  }
  const now = new Date();
  if (link.revoked_at) {
    return { error: errorResponse('TOKEN_REVOKED', 'Este enlace ha sido revocado', 410) } as const;
  }
  if (link.expires_at && now >= link.expires_at) {
    return { error: errorResponse('TOKEN_EXPIRED', 'Este enlace ha expirado', 410) } as const;
  }
  return { link } as const;
}

async function touchLink(
  prisma: ReturnType<typeof getPrisma>,
  linkId: string,
  ip: string | null,
  userAgent: string | null,
) {
  const now = nowInMadridDate();
  await prisma.session_public_links.update({
    where: { id: linkId },
    data: {
      last_access_at: now,
      last_access_ip: ip ? ip.slice(0, 64) : null,
      last_access_ua: userAgent ? userAgent.slice(0, 512) : null,
    },
  });
}

function logAudit(event: any, link: any, action: string, details: Record<string, unknown> = {}) {
  const payload = {
    scope: 'public-session-students',
    action,
    link_id: link?.id ?? null,
    sesion_id: link?.sesion_id ?? null,
    deal_id: link?.deal_id ?? null,
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
    const userAgent = extractUserAgent(event);

    if (method === 'GET') {
      await touchLink(prisma, link.id, ip, userAgent);
      logAudit(event, link, 'list');
      const students = await prisma.alumnos.findMany({
        where: { sesion_id: link.sesion_id },
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
        where: { sesion_id: link.sesion_id, dni },
        select: { id: true },
      });
      if (duplicate) {
        return errorResponse('DUPLICATE_DNI', 'Este DNI ya existe en esta sesión', 409);
      }

      const now = nowInMadridDate();
      const created = await prisma.alumnos.create({
        data: {
          deal_id: link.deal_id,
          sesion_id: link.sesion_id,
          nombre,
          apellido,
          dni,
          apto: false,
          certificado: false,
          created_at: now,
          updated_at: now,
        },
      });

      await touchLink(prisma, link.id, ip, userAgent);
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
        where: { id: studentIdTrimmed, sesion_id: link.sesion_id },
      });

      if (!existing) {
        return errorResponse('NOT_FOUND', 'Alumno no encontrado', 404);
      }

      const nombre = payload.nombre === undefined ? undefined : normalizeText(payload.nombre);
      const apellido = payload.apellido === undefined ? undefined : normalizeText(payload.apellido);
      const dni = payload.dni === undefined ? undefined : normalizeDni(payload.dni);

      const data: Prisma.alumnosUpdateInput = {};

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
            sesion_id: link.sesion_id,
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

      await touchLink(prisma, link.id, ip, userAgent);
      logAudit(event, link, 'update', { student_id: updated.id });
      return successResponse({ student: mapStudent(updated) });
    }

    if (method === 'DELETE' && studentId) {
      const studentIdTrimmed = studentId.trim();
      if (!studentIdTrimmed || !isUUID(studentIdTrimmed)) {
        return errorResponse('VALIDATION_ERROR', 'id de alumno inválido (UUID requerido)', 400);
      }

      const existing = await prisma.alumnos.findFirst({
        where: { id: studentIdTrimmed, sesion_id: link.sesion_id },
        select: { id: true },
      });

      if (!existing) {
        return errorResponse('NOT_FOUND', 'Alumno no encontrado', 404);
      }

      await prisma.alumnos.delete({ where: { id: studentIdTrimmed } });

      await touchLink(prisma, link.id, ip, userAgent);
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
