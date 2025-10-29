import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import {
  buildClearSessionCookie,
  extractSessionIdFromRequest,
} from './_shared/auth';

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const sessionId = extractSessionIdFromRequest(request);

  if (sessionId) {
    try {
      await prisma.auth_sessions.update({
        where: { id: sessionId },
        data: { revoked_at: new Date() },
      });
    } catch (err) {
      // Si la sesión no existe o ya está revocada, no rompemos el logout.
      console.warn('[auth-logout] No se pudo revocar la sesión:', err);
    }
  }

  return {
    ...successResponse(),
    headers: {
      'Set-Cookie': buildClearSessionCookie(),
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
    },
  };
});
