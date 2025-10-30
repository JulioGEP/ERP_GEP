import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import {
  generateResetToken,
  getResetTokenExpirationDate,
  normalizeEmail,
  extractSessionIdFromRequest,
  findActiveSession,
} from './_shared/auth';

export const handler = createHttpHandler<any>(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();

  try {
    const email = normalizeEmail((request.body as any)?.email);

    const canExposeLink = await canExposeResetLink(request, prisma);

    // Respuesta genérica para evitar enumeración de usuarios
    const genericOk = () =>
      successResponse({
        message: 'Si el usuario existe, recibirá un email con instrucciones.',
      });

    if (!email) {
      return genericOk();
    }

    const user = await prisma.users.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });

    if (!user || !user.active) {
      // Usuario inexistente o inactivo → misma respuesta genérica
      return genericOk();
    }

    const token = generateResetToken();
    const expiresAt = getResetTokenExpirationDate();

    await prisma.users.update({
      where: { id: user.id },
      data: {
        reset_token: token,
        reset_token_expires: expiresAt,
        reset_requested_at: new Date(),
        reset_used_at: null,
      },
    });

    // Stub "envío de email"
    console.info('[auth] Password reset requested', {
      userId: user.id,
      email: user.email,
      token, // En producción no logarías el token; aquí está a modo de stub.
      expiresAt: expiresAt.toISOString(),
    });

    if (!canExposeLink) {
      return genericOk();
    }

    const resetUrl = buildResetUrl(request, token);

    if (!resetUrl) {
      return successResponse({
        message: 'Enlace generado, pero no se pudo construir la URL pública.',
        expiresAt: expiresAt.toISOString(),
      });
    }

    return successResponse({
      message: 'Enlace de restablecimiento generado correctamente.',
      resetUrl,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (_err) {
    // No exponemos detalles internos
    return errorResponse('INTERNAL', 'No se pudo procesar la solicitud', 500);
  }
});

async function canExposeResetLink(request: any, prisma: ReturnType<typeof getPrisma>): Promise<boolean> {
  try {
    const sessionId = extractSessionIdFromRequest(request);
    if (!sessionId) return false;
    const auth = await findActiveSession(prisma, sessionId);
    if (!auth) return false;
    const role = auth.user?.role?.trim().toLowerCase();
    return role === 'admin';
  } catch (error) {
    console.error('[auth] Failed to resolve admin context for reset link', error);
    return false;
  }
}

function buildResetUrl(request: any, token: string): string | null {
  const baseFromEnv = process.env.PASSWORD_RESET_BASE_URL;
  const base =
    (typeof baseFromEnv === 'string' && baseFromEnv.trim().length
      ? baseFromEnv.trim()
      : inferOriginFromRequest(request)) || null;
  if (!base) return null;

  try {
    const url = new URL(base);
    url.pathname = '/auth/password/reset';
    url.search = '';
    url.searchParams.set('token', token);
    url.hash = '';
    return url.toString();
  } catch (error) {
    console.error('[auth] Failed to construct reset URL', error);
    return null;
  }
}

function inferOriginFromRequest(request: any): string | null {
  const headers = request.headers ?? {};
  const originHeader = headers['origin'] ?? headers['referer'];
  if (typeof originHeader === 'string') {
    try {
      const url = new URL(originHeader);
      return `${url.protocol}//${url.host}`;
    } catch {
      // Ignorar
    }
  }

  const forwardedProto = headers['x-forwarded-proto'];
  const forwardedHost = headers['x-forwarded-host'];
  const host = headers['host'];

  if (typeof forwardedProto === 'string' && typeof (forwardedHost || host) === 'string') {
    return `${forwardedProto}://${forwardedHost || host}`;
  }

  const rawUrl = typeof request.event?.rawUrl === 'string' ? request.event.rawUrl : null;
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      return `${url.protocol}//${url.host}`;
    } catch {
      // Ignorar
    }
  }

  return null;
}
