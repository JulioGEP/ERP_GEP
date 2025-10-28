import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import {
  generateResetToken,
  getResetTokenExpirationDate,
  normalizeEmail,
} from './_shared/auth';

export const handler = createHttpHandler<any>(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const email = normalizeEmail((request.body as any)?.email);
  if (!email) {
    // Respuesta genérica para evitar enumeración
    return successResponse({ message: 'Si el usuario existe, recibirá un email con instrucciones.' });
  }

  const prisma = getPrisma();
  const user = await prisma.users.findUnique({ where: { email } });

  if (user && user.active) {
    const token = generateResetToken();
    const expiresAt = getResetTokenExpirationDate();

    await prisma.users.update({
      where: { id: user.id },
      data: {
        reset_token: token,
        reset_token_expires: expiresAt,
        reset_requested_at: new Date(),
        reset_used_at: null,
      },
    });

    console.info('[auth] Password reset requested', {
      userId: user.id,
      email: user.email,
      token,
      expiresAt: expiresAt.toISOString(),
    });
  }

  return successResponse({ message: 'Si el usuario existe, recibirá un email con instrucciones.' });
});
