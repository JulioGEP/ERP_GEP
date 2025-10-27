// backend/functions/auth/logout.ts
import { createHttpHandler } from '../_shared/http';
import { errorResponse, successResponse } from '../_shared/response';
import { getPrisma } from '../_shared/prisma';
import {
  buildClearSessionCookie,
  destroySession,
  requireAuth,
} from '../_lib/auth';

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(prisma, request, { allowMissing: true });

  if (auth) {
    await destroySession(prisma, auth.session.id);
  }

  const response = successResponse();
  return {
    ...response,
    headers: {
      ...response.headers,
      'Set-Cookie': buildClearSessionCookie(),
    },
  };
});
