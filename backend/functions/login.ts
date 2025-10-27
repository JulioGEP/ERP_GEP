import type { users } from '@prisma/client';

import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { createUserSession, serializeUser } from './_shared/auth';
import { ROLE_PERMISSIONS } from './_shared/permissions';

type LoginBody = {
  email?: unknown;
  password?: unknown;
};

function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw errorResponse('VALIDATION_ERROR', 'El email es obligatorio.', 400);
  }
  const email = value.trim().toLowerCase();
  const emailRegex = /^(?:[^\s@]+)@(?:[^\s@]+)\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw errorResponse('VALIDATION_ERROR', 'El email no tiene un formato válido.', 400);
  }
  return email;
}

function normalizePassword(value: unknown): string {
  if (typeof value !== 'string') {
    throw errorResponse('VALIDATION_ERROR', 'La contraseña es obligatoria.', 400);
  }
  const password = value.trim();
  if (!password.length) {
    throw errorResponse('VALIDATION_ERROR', 'La contraseña es obligatoria.', 400);
  }
  return password;
}

export default createHttpHandler(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
  }

  const prisma = getPrisma();
  const body = (request.body ?? {}) as LoginBody;

  let email: string;
  let password: string;
  try {
    email = normalizeEmail(body.email);
    password = normalizePassword(body.password);
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      return error as ReturnType<typeof errorResponse>;
    }
    return errorResponse('VALIDATION_ERROR', 'Datos de acceso inválidos.', 400);
  }

  let user: users | null = null;
  try {
    const records = await prisma.$queryRaw<users[]>`
      SELECT *
      FROM "users"
      WHERE lower(email) = ${email}
        AND active = true
        AND password_hash IS NOT NULL
        AND password_hash = crypt(${password}, password_hash)
      LIMIT 1
    `;
    user = records.length ? records[0] : null;
  } catch (error) {
    const errorWithCode =
      error && typeof error === 'object'
        ? (error as { code?: string; message?: string })
        : null;
    const needsPgcrypto =
      errorWithCode?.code === '42883' ||
      (errorWithCode?.message ?? '').includes('crypt');

    if (needsPgcrypto) {
      console.error(
        '[login] pgcrypto (crypt) no está disponible en la base de datos',
        error
      );
      return errorResponse(
        'AUTH_BACKEND_MISCONFIGURED',
        'El servicio de autenticación no está disponible. Pide al administrador que habilite la extensión pgcrypto.',
        503
      );
    }

    console.error('[login] Error verificando credenciales con crypt()', error);
    return errorResponse('UNEXPECTED_ERROR', 'No se pudo validar las credenciales.', 500);
  }

  if (!user) {
    return errorResponse('INVALID_CREDENTIALS', 'Usuario o contraseña no válidos.', 401);
  }

  const { token, session } = await createUserSession(user.id);

  return successResponse({
    data: {
      token,
      expires_at:
        session.expires_at instanceof Date ? session.expires_at.toISOString() : session.expires_at,
      user: serializeUser(user),
      permissions: ROLE_PERMISSIONS,
    },
  });
});
