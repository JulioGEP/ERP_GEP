import { getGmailAccessToken } from './_shared/googleJwt';
import { google } from 'googleapis';

async function getAccessToken(): Promise<string> { return getGmailAccessToken(); }
function _normalizeSaKey(k: string = ''): string {
  const trimmed = (k || '').trim();
  const hasLiteral = /\\n/.test(trimmed);
  const materialized = hasLiteral ? trimmed.replace(/\\n/g, '\n') : trimmed;
  return materialized.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');
}

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

      },
    });

    let resetUrl: string | null = null;

    try {
      resetUrl = buildResetUrl(request, token);
    } catch (error) {
      console.error('[auth] Failed to build password reset URL', error);
    }

    if (resetUrl) {
      try {
        const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || null;
        await sendPasswordResetEmail({
          toEmail: user.email,
          toName: fullName,
          resetUrl,
          expiresAt,
        });
      } catch (error) {
        console.error('[auth] Failed to send password reset email', {
          userId: user.id,
          email: user.email,
          error,
        });
      }
    } else {
      console.warn('[auth] Password reset URL could not be determined for email delivery', {
        userId: user.id,
        email: user.email,
      });
    }

    if (!canExposeLink) {
      return genericOk();
    }

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
    console.error('[auth] Failed to construct reset URL', error);
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
