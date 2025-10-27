import { randomBytes } from 'crypto';

import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { hashSessionToken } from './_shared/auth';

type PasswordResetRequestBody = {
  email?: unknown;
};

const RESET_TOKEN_BYTES = 48;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

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

export default createHttpHandler(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
  }

  const prisma = getPrisma();
  const body = (request.body ?? {}) as PasswordResetRequestBody;

  let email: string;
  try {
    email = normalizeEmail(body.email);
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      return error as ReturnType<typeof errorResponse>;
    }
    return errorResponse('VALIDATION_ERROR', 'El email no es válido.', 400);
  }

  const genericSuccess = successResponse({
    data: {
      message:
        'Si el correo existe en nuestro sistema, recibirás un email con instrucciones para restablecer la contraseña.',
    },
  });

  const user = await prisma.users.findFirst({
    where: {
      email,
      active: true,
    },
    select: { id: true },
  });

  if (!user) {
    return genericSuccess;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESET_TOKEN_TTL_MS);
  const token = randomBytes(RESET_TOKEN_BYTES).toString('base64url');
  const tokenHash = hashSessionToken(token);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.password_reset_tokens.updateMany({
        where: {
          user_id: user.id,
          used_at: null,
        },
        data: { used_at: now },
      });

      await tx.password_reset_tokens.create({
        data: {
          user_id: user.id,
          token_hash: tokenHash,
          expires_at: expiresAt,
        },
      });
    });
  } catch (error) {
    console.error('[password-reset-request] Error creando token de restablecimiento', error);
    return errorResponse(
      'UNEXPECTED_ERROR',
      'No se pudo iniciar el proceso de recuperación de contraseña.',
      500,
    );
  }

  if (process.env.NODE_ENV !== 'production') {
    const resetUrl = new URL(request.event.rawUrl ?? 'http://localhost');
    resetUrl.pathname = '/restablecer-contraseña';
    resetUrl.searchParams.set('token', token);
    console.info('[password-reset-request] URL de restablecimiento generada:', resetUrl.toString());
  }

  return genericSuccess;
});
