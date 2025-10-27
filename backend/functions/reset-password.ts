import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { hashSessionToken } from './_shared/auth';

type ResetPasswordBody = {
  token?: unknown;
  password?: unknown;
};

function normalizeToken(value: unknown): string {
  if (typeof value !== 'string') {
    throw errorResponse('VALIDATION_ERROR', 'El token de restablecimiento es obligatorio.', 400);
  }
  const token = value.trim();
  if (!token.length) {
    throw errorResponse('VALIDATION_ERROR', 'El token de restablecimiento es obligatorio.', 400);
  }
  return token;
}

function normalizePassword(value: unknown): string {
  if (typeof value !== 'string') {
    throw errorResponse('VALIDATION_ERROR', 'La contraseña es obligatoria.', 400);
  }
  const password = value.trim();
  if (password.length < 8) {
    throw errorResponse(
      'VALIDATION_ERROR',
      'La contraseña debe tener al menos 8 caracteres.',
      400,
    );
  }
  return password;
}

export default createHttpHandler(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
  }

  const prisma = getPrisma();
  const body = (request.body ?? {}) as ResetPasswordBody;

  let token: string;
  let password: string;
  try {
    token = normalizeToken(body.token);
    password = normalizePassword(body.password);
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      return error as ReturnType<typeof errorResponse>;
    }
    return errorResponse('VALIDATION_ERROR', 'Los datos proporcionados no son válidos.', 400);
  }

  const tokenHash = hashSessionToken(token);
  const now = new Date();

  const resetRequest = await prisma.password_reset_tokens.findFirst({
    where: {
      token_hash: tokenHash,
      used_at: null,
      expires_at: { gt: now },
    },
  });

  if (!resetRequest) {
    return errorResponse(
      'TOKEN_INVALID',
      'El enlace de restablecimiento no es válido o ya expiró.',
      400,
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "users"
        SET
          password_hash = crypt(${password}, gen_salt('bf')),
          password_algo = ${'bcrypt'},
          password_updated_at = NOW()
        WHERE id = ${resetRequest.user_id}
      `;

      await tx.password_reset_tokens.update({
        where: { id: resetRequest.id },
        data: { used_at: now },
      });

      await tx.password_reset_tokens.updateMany({
        where: {
          user_id: resetRequest.user_id,
          used_at: null,
          expires_at: { gt: now },
        },
        data: { used_at: now },
      });

      await tx.user_sessions.updateMany({
        where: { user_id: resetRequest.user_id, revoked_at: null },
        data: { revoked_at: now },
      });
    });
  } catch (error) {
    console.error('[reset-password] Error actualizando la contraseña', error);
    return errorResponse('UNEXPECTED_ERROR', 'No se pudo restablecer la contraseña.', 500);
  }

  return successResponse({
    data: {
      message: 'La contraseña se actualizó correctamente. Ya puedes iniciar sesión.',
    },
  });
});
