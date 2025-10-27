// backend/functions/auth/me.ts
import { createHttpHandler } from '../_shared/http';
import { errorResponse, successResponse } from '../_shared/response';
import { getPrisma } from '../_shared/prisma';
import { AuthError, requireAuth } from '../_lib/auth';

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();

  try {
    const auth = await requireAuth(prisma, request);
    const response = successResponse({
      me: auth.user,
    });

    if (auth.sessionCookie) {
      return {
        ...response,
        headers: {
          ...response.headers,
          'Set-Cookie': auth.sessionCookie,
        },
      };
    }

    return response;
  } catch (error) {
    if (error instanceof AuthError && error.code === 'UNAUTHORIZED') {
      return errorResponse('UNAUTHORIZED', 'No autorizado', 401);
    }
    throw error;
  }
});
