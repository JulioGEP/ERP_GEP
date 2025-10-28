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
    } catch (error) {
      console.warn('[auth] No se pudo revocar la sesión', error);
    }
  }

  return {
    ...successResponse(),
    headers: {
      'Set-Cookie': buildClearSessionCookie(),
    },
  };
});
