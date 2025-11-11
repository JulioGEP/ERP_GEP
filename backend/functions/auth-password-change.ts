import * as bcrypt from 'bcryptjs';
import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import { requireAuth } from './_shared/auth';
import { logAudit, type JsonValue } from './_shared/audit-log';

const MIN_PASSWORD_LENGTH = 8;
const BCRYPT_SALT_ROUNDS = 10;

function isSupportedHash(hash: string | null | undefined): boolean {
  if (!hash) return false;
  return /^\$2[aby]\$/.test(hash);
}

export const handler = createHttpHandler<any>(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma);

  if ('error' in auth) {
    return auth.error;
  }

  const currentPassword =
    typeof request.body?.currentPassword === 'string' ? request.body.currentPassword : '';
  const newPassword =
    typeof request.body?.newPassword === 'string' ? request.body.newPassword : '';

  if (!currentPassword || !newPassword) {
    return errorResponse('INVALID_INPUT', 'Debes indicar la contraseña actual y la nueva.', 400);
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return errorResponse(
      'INVALID_PASSWORD',
      `La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
      400,
    );
  }

  const user = auth.user;

  if (!user.password_hash) {
    return errorResponse('INVALID_CREDENTIALS', 'La contraseña actual no es válida.', 400);
  }

  if (!isSupportedHash(user.password_hash)) {
    return errorResponse('INVALID_CREDENTIALS', 'La contraseña actual no es válida.', 400);
  }

  const matches = await bcrypt.compare(currentPassword, user.password_hash);
  if (!matches) {
    return errorResponse('INVALID_CREDENTIALS', 'La contraseña actual no es válida.', 400);
  }

  if (currentPassword === newPassword) {
    return errorResponse(
      'INVALID_PASSWORD',
      'La nueva contraseña debe ser diferente a la actual.',
      400,
    );
  }

  const now = new Date();
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);

  try {
    await prisma.users.update({
      where: { id: user.id },
      data: {
        password_hash: passwordHash,
        password_algo: 'bcrypt',
        password_updated_at: now,
      },
    });

    await prisma.auth_sessions.updateMany({
      where: {
        user_id: user.id,
        revoked_at: null,
        NOT: { id: auth.session.id },
      },
      data: { revoked_at: now },
    });

    const previousUpdatedAt =
      user.password_updated_at instanceof Date
        ? user.password_updated_at.toISOString()
        : user.password_updated_at ?? null;

    try {
      await logAudit({
        userId: user.id,
        action: 'auth.password_change',
        entityType: 'user',
        entityId: user.id,
        before: { password_updated_at: previousUpdatedAt } as JsonValue,
        after: { password_updated_at: now.toISOString() } as JsonValue,
      });
    } catch (auditError) {
      console.error('[auth-password-change] Failed to log password change', auditError);
    }

    return successResponse({ message: 'Contraseña actualizada correctamente.' });
  } catch (error) {
    console.error('[auth-password-change] Failed to update password', error as Error);
    return errorResponse('UPDATE_FAILED', 'No se pudo actualizar la contraseña.', 500);
  }
});
