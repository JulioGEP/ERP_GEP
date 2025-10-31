import * as bcrypt from 'bcryptjs';
import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';

export const handler = createHttpHandler<any>(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  try {
    const token =
      typeof (request.body as any)?.token === 'string'
        ? (request.body as any).token.trim()
        : '';
    const newPassword =
      typeof (request.body as any)?.new_password === 'string'
        ? (request.body as any).new_password
        : '';

    if (!token.length || !newPassword.length) {
      return errorResponse('INVALID_INPUT', 'Token o contraseña inválida', 400);
    }

    if (newPassword.length < 8) {
      return errorResponse('WEAK_PASSWORD', 'La contraseña debe tener al menos 8 caracteres', 400);
    }

    const prisma = getPrisma();

    // Buscar usuario con token vigente
    const user = await prisma.users.findFirst({
      where: {
        reset_token: token,
        reset_token_expires: { gt: new Date() },
        active: true,
      },
    });

    if (!user) {
      return errorResponse('INVALID_TOKEN', 'Token de restablecimiento inválido o caducado', 400);
    }

    // Generar nuevo hash bcrypt
    const saltRounds = 12;
    const hash = await bcrypt.hash(newPassword, saltRounds);
    const now = new Date();

    await prisma.$transaction([
      prisma.users.update({
        where: { id: user.id },
        data: {
          password_hash: hash,
          password_algo: 'bcrypt',
          password_updated_at: now,
          
          reset_token: null,
          reset_token_expires: null,
        },
      }),
      // Revocamos todas las sesiones activas del usuario
      prisma.auth_sessions.updateMany({
        where: { user_id: user.id, revoked_at: null },
        data: { revoked_at: now },
      }),
    ]);

    return successResponse({ message: 'Contraseña actualizada correctamente' });
  } catch (_err) {
    return errorResponse('INTERNAL', 'No se pudo completar el restablecimiento', 500);
  }
});
