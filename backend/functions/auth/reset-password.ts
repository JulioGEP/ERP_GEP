// backend/functions/auth/reset-password.ts
import { createHttpHandler } from '../_shared/http';
import { errorResponse, successResponse } from '../_shared/response';
import { getPrisma } from '../_shared/prisma';
import { hashPassword, invalidateUserSessions, validatePassword } from '../_lib/auth';

interface ResetPasswordBody {
  token?: unknown;
  new_password?: unknown;
}

interface ResetUserRecord {
  id: string;
}

function normalizeToken(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizePassword(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return value;
}

export const handler = createHttpHandler<ResetPasswordBody>(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const token = normalizeToken(request.body?.token);
  const password = normalizePassword(request.body?.new_password);

  if (!token || !password) {
    return errorResponse('VALIDATION_ERROR', 'Token y contraseña son obligatorios', 400);
  }

  const passwordValidation = validatePassword(password);
  if (!passwordValidation.ok) {
    return errorResponse('VALIDATION_ERROR', passwordValidation.message, 400);
  }

  const prisma = getPrisma();

  const users = await prisma.$queryRaw<ResetUserRecord[]>`
    SELECT id
    FROM users
    WHERE reset_token = ${token}
      AND reset_token_expires IS NOT NULL
      AND reset_token_expires > now()
      AND active = true
    LIMIT 1
  `;

  if (!users.length) {
    return errorResponse('INVALID_TOKEN', 'El enlace de restablecimiento no es válido o ha caducado', 400);
  }

  const user = users[0];
  const hashedPassword = await hashPassword(password, prisma);

  await prisma.$executeRaw`
    UPDATE users
    SET password_hash = ${hashedPassword},
        password_algo = 'bcrypt',
        password_updated_at = now(),
        reset_token = NULL,
        reset_token_expires = NULL,
        reset_requested_at = NULL,
        updated_at = now()
    WHERE id = ${user.id}::uuid
  `;

  await invalidateUserSessions(prisma, user.id);

  return successResponse({ message: 'Contraseña actualizada correctamente' });
});
