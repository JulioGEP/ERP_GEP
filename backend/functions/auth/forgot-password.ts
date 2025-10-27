// backend/functions/auth/forgot-password.ts
import { URL } from 'node:url';

import { createHttpHandler } from '../_shared/http';
import { errorResponse, successResponse } from '../_shared/response';
import { getPrisma } from '../_shared/prisma';
import { generateResetToken } from '../_lib/auth';

interface ForgotPasswordBody {
  email?: unknown;
}

interface ForgotUserRecord {
  id: string;
  email: string;
  active: boolean;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function buildResetLink(token: string): string | null {
  const base = process.env.PASSWORD_RESET_URL?.trim();
  if (!base) {
    return null;
  }

  try {
    const url = new URL(base);
    url.searchParams.set('token', token);
    return url.toString();
  } catch (error) {
    console.warn('[auth] PASSWORD_RESET_URL inválida', error);
    return null;
  }
}

export const handler = createHttpHandler<ForgotPasswordBody>(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const email = normalizeEmail(request.body?.email);
  if (!email) {
    return errorResponse('VALIDATION_ERROR', 'El email es obligatorio', 400);
  }

  const prisma = getPrisma();
  const users = await prisma.$queryRaw<ForgotUserRecord[]>`
    SELECT id, email, active
    FROM users
    WHERE lower(email) = lower(${email})
    LIMIT 1
  `;

  const message = successResponse({
    message: 'Si existe una cuenta activa se ha enviado un enlace de recuperación',
  });

  if (!users.length) {
    return message;
  }

  const user = users[0];
  if (!user.active) {
    return message;
  }

  const token = generateResetToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await prisma.$executeRaw`
    UPDATE users
    SET reset_token = ${token},
        reset_token_expires = ${expiresAt},
        reset_requested_at = now(),
        updated_at = now()
    WHERE id = ${user.id}
  `;

  const link = buildResetLink(token);
  if (link) {
    console.info(`[auth] Enlace de restablecimiento para ${user.email}: ${link}`);
  } else {
    console.info(`[auth] Token de restablecimiento para ${user.email}: ${token}`);
  }

  return message;
});
