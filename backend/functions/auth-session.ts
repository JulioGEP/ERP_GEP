import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import {
  buildClearSessionCookie,
  extractSessionIdFromRequest,
  findActiveSession,
} from './_shared/auth';

function serializeUser(user: any) {
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    role: user.role,
    active: user.active,
  };
}

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const sessionId = extractSessionIdFromRequest(request);

  if (!sessionId) {
    return successResponse({ user: null, permissions: [] });
  }

  const auth = await findActiveSession(prisma, sessionId);

  if (!auth) {
    return {
      ...successResponse({ user: null, permissions: [] }),
      headers: {
        'Set-Cookie': buildClearSessionCookie(),
      },
    };
  }

  return successResponse({ user: serializeUser(auth.user), permissions: auth.permissions });
});
