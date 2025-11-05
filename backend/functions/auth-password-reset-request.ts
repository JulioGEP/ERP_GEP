import { createHttpHandler, setRefreshSessionCookie, type HttpRequest } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import {
  generateResetToken,
  getResetTokenExpirationDate,
  normalizeEmail,
  extractSessionIdFromRequest,
  findActiveSession,
} from './_shared/auth';
import { sendPasswordResetEmail } from './_shared/mailer';

export const handler = createHttpHandler<any>(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();

  try {
    const email = normalizeEmail((request.body as any)?.email);

    const canExposeLink = await canExposeResetLink(request, prisma);

    // Respuesta genérica para evitar enumeración de usuarios
    const genericOk = (extra?: Record<string, unknown>) =>
      successResponse({
        message: 'Mail enviado, revisa tu buzón de entrada o SPAM',
        ...(extra || {}),
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
      },
    });

    let resetUrl: string | null = null;
    try {
      resetUrl = buildResetUrl(request, token);
    } catch (error) {
      console.error('[auth-reset] Failed to build password reset URL', error);
    }

    let messageId: string | undefined;

    if (resetUrl) {
  try {
    const fullName =
      [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || null;

    // mailer.ts espera 2 args: (toEmail: string, resetUrl: string)
    await sendPasswordResetEmail(user.email, resetUrl);

    console.info('[auth-reset] mail queued (mailer returned void)', {
      userId: user.id,
      to: user.email,
      fullName,
      resetUrl,
      expiresAt,
    });
  } catch (error) {
    const detail = (error as any)?.response?.data ?? (error as any)?.message ?? error;
    console.error('[auth-reset] Failed to send password reset email', {
      userId: user.id,
      email: user.email,
      detail,
    });
    // seguimos sin romper respuesta genérica
  }
} else {
  console.warn('[auth-reset] Password reset URL could not be determined for email delivery', {
    userId: user.id,
    email: user.email,
  });
}

    // Si no podemos exponer info sensible: respuesta genérica SIEMPRE
    if (!canExposeLink) {
      return genericOk();
    }

    // Admin: devolvemos detalles útiles para diagnóstico
    if (!resetUrl) {
      return successResponse({
        message: 'Enlace generado, pero no se pudo construir la URL pública.',
        expiresAt: expiresAt.toISOString(),
        messageId: messageId || null,
      });
    }

    return successResponse({
      message: 'Enlace de restablecimiento generado correctamente.',
      resetUrl,
      expiresAt: expiresAt.toISOString(),
      messageId: messageId || null,
    });
  } catch (_err) {
    // No exponemos detalles internos
    console.error('[auth-reset] INTERNAL ERROR', _err);
    return errorResponse('INTERNAL', 'No se pudo procesar la solicitud', 500);
  }
});

async function canExposeResetLink(
  request: HttpRequest<any>,
  prisma: ReturnType<typeof getPrisma>,
): Promise<boolean> {
  try {
    const sessionId = extractSessionIdFromRequest(request);
    if (!sessionId) return false;
    const auth = await findActiveSession(prisma, sessionId);
    if (!auth) return false;
    if (auth.refreshedCookie) {
      setRefreshSessionCookie(request, auth.refreshedCookie);
    }
    const role = auth.user?.role?.trim().toLowerCase();
    return role === 'admin';
  } catch (error) {
    console.error('[auth-reset] Failed to resolve admin context for reset link', error);
    return false;
  }
}

function buildResetUrl(request: any, token: string): string | null {
  const base = resolveBaseUrl(request);
  if (!base) return null;

  try {
    const url = new URL(base);
    url.pathname = '/auth/password/reset';
    url.search = '';
    url.searchParams.set('token', token);
    url.hash = '';
    return url.toString();
  } catch (error) {
    console.error('[auth-reset] Failed to construct reset URL', error);
    return null;
  }
}

function resolveBaseUrl(request: any): string | null {
  const fromEnv = getBaseUrlFromEnv();
  if (fromEnv) return fromEnv;
  return inferOriginFromRequest(request);
}

function getBaseUrlFromEnv(): string | null {
  const candidates = [
    process.env.PASSWORD_RESET_BASE_URL,
    process.env.PUBLIC_FRONTEND_BASE_URL,
    process.env.URL,
    process.env.DEPLOY_PRIME_URL,
    process.env.DEPLOY_URL,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (!trimmed.length) continue;
    try {
      const url = new URL(trimmed);
      return `${url.protocol}//${url.host}`;
    } catch {
      continue;
    }
  }

  return null;
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
