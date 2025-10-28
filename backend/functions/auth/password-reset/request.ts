import { createHttpHandler } from '../../_shared/http';
import { getPrisma } from '../../_shared/prisma';
import { createResetToken, normalizeEmail, resetTokenExpiryDate } from '../../_shared/auth';
import { errorResponse, successResponse } from '../../_shared/response';

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
  }

  const prisma = getPrisma();
  const body = request.body ?? {};
  const email = normalizeEmail((body as any).email);

  if (!email) {
    return errorResponse('INVALID_EMAIL', 'Debes indicar un correo electrónico válido.', 400);
  }

  try {
    const user = await prisma.users.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });

    if (user) {
      const token = createResetToken();
      await prisma.users.update({
        where: { id: user.id },
        data: {
          reset_token: token,
          reset_token_expires: resetTokenExpiryDate(),
          reset_requested_at: new Date(),
          reset_used_at: null,
        },
      });
    }
  } catch (error) {
    console.error('[auth/password-reset/request] Failed to create token', error);
    return errorResponse(
      'RESET_ERROR',
      'No se pudo iniciar el proceso de recuperación. Inténtalo de nuevo más tarde.',
      500,
    );
  }

  return successResponse({ message: 'Si el correo existe, enviaremos instrucciones para restablecer la contraseña.' });
});
