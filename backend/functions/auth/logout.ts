import { createHttpHandler } from '../_shared/http';
import { getPrisma } from '../_shared/prisma';
import {
  createExpiredSessionCookie,
  getSessionIdFromHeaders,
} from '../_shared/auth';
import { COMMON_HEADERS, errorResponse, successResponse } from '../_shared/response';

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
  }

  const prisma = getPrisma();
  const sessionId = getSessionIdFromHeaders(request.headers);

  if (sessionId) {
    try {
      await prisma.auth_sessions.updateMany({
        where: { id: sessionId },
        data: { revoked_at: new Date() },
      });
    } catch (error) {
      console.error('[auth/logout] Failed to revoke session', error);
    }
  }

  const cookie = createExpiredSessionCookie();

  const response = successResponse({ message: 'Sesión cerrada.' });
  return {
    ...response,
    headers: {
      ...(response.headers ?? COMMON_HEADERS),
      'Set-Cookie': cookie,
    },
  };
});
