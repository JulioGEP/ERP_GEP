import { createHttpHandler } from '../../_shared/http';
import { getPrisma } from '../../_shared/prisma';
import {
  hashPassword,
  normalizeString,
} from '../../_shared/auth';
import { errorResponse, successResponse } from '../../_shared/response';

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
  }

  const prisma = getPrisma();
  const body = request.body ?? {};

  const token = normalizeString((body as any).token);
  const password = normalizeString((body as any).password);

  if (!token) {
    return errorResponse('INVALID_TOKEN', 'Token de recuperación inválido.', 400);
  }

  if (!password || password.length < 6) {
    return errorResponse(
      'INVALID_PASSWORD',
      'La nueva contraseña debe tener al menos 6 caracteres.',
      400,
    );
  }

  const user = await prisma.users.findFirst({
    where: { reset_token: token },
    select: { id: true, reset_token_expires: true },
  });

  if (!user) {
    return errorResponse('INVALID_TOKEN', 'Token de recuperación inválido.', 400);
  }

  if (user.reset_token_expires && user.reset_token_expires <= new Date()) {
    return errorResponse('TOKEN_EXPIRED', 'El token de recuperación ha caducado.', 400);
  }

  const hashedPassword = await hashPassword(prisma, password);

  await prisma.$transaction([
    prisma.users.update({
      where: { id: user.id },
      data: {
        password_hash: hashedPassword,
        password_algo: 'bcrypt',
        password_updated_at: new Date(),
        reset_token: null,
        reset_token_expires: null,
        reset_used_at: new Date(),
        active: true,
      },
    }),
    prisma.auth_sessions.updateMany({
      where: { user_id: user.id, revoked_at: null },
      data: { revoked_at: new Date() },
    }),
  ]);

  return successResponse({ message: 'La contraseña se ha restablecido correctamente.' });
});
