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

  const prisma = getPrisma();

  try {
    const email = normalizeEmail((request.body as any)?.email);

    // Respuesta genérica para evitar enumeración de usuarios
    const genericOk = () =>
      successResponse({
        message: 'Si el usuario existe, recibirá un email con instrucciones.',
      });

    if (!email) {
      return genericOk();
    }

    const user = await prisma.users.findUnique({ where: { email } });

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
        reset_used_at: null,
      },
    });

    // Stub "envío de email"
    console.info('[auth] Password reset requested', {
      userId: user.id,
      email: user.email,
      token, // En producción no logarías el token; aquí está a modo de stub.
      expiresAt: expiresAt.toISOString(),
    });

    return genericOk();
  } catch (_err) {
    // No exponemos detalles internos
    return errorResponse('INTERNAL', 'No se pudo procesar la solicitud', 500);
  }
});
