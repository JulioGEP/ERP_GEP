import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';

export const handler = createHttpHandler<any>(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const token = typeof (request.body as any)?.token === 'string' ? (request.body as any).token.trim() : '';
  const newPassword = typeof (request.body as any)?.new_password === 'string'
    ? (request.body as any).new_password
    : '';

  if (!token.length || !newPassword.length) {
    return errorResponse('INVALID_INPUT', 'Token o contraseña inválida', 400);
  }

  if (newPassword.length < 8) {
    return errorResponse('WEAK_PASSWORD', 'La contraseña debe tener al menos 8 caracteres', 400);
  }

  const prisma = getPrisma();
  const user = await prisma.users.findFirst({
    where: {
      reset_token: token,
      reset_token_expires: { gt: new Date() },
    },
  });

  if (!user) {
    return errorResponse('INVALID_TOKEN', 'Token de restablecimiento inválido o caducado', 400);
  }

  const [generated] = await prisma.$queryRaw<{ hash: string }[]>`
    SELECT crypt(${newPassword}, gen_salt('bf', 12)) AS hash
  `;

  if (!generated?.hash) {
    return errorResponse('HASH_FAILED', 'No se pudo generar la contraseña', 500);
  }

  const now = new Date();

  await prisma.$transaction([
    prisma.users.update({
      where: { id: user.id },
      data: {
        password_hash: generated.hash,
        password_algo: 'bcrypt',
        password_updated_at: now,
        reset_used_at: now,
        reset_token: null,
        reset_token_expires: null,
      },
    }),
    prisma.auth_sessions.updateMany({
      where: { user_id: user.id, revoked_at: null },
      data: { revoked_at: now },
    }),
  ]);

  return successResponse({ message: 'Contraseña actualizada correctamente' });
});
