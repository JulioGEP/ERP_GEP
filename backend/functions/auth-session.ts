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

  if (!process.env.DATABASE_URL) {
    console.warn('[auth-session] DATABASE_URL no está configurada. Se devuelve sesión vacía');
    return successResponse({ user: null, permissions: [] });
  }

  const prisma = getPrisma();
  const sessionId = extractSessionIdFromRequest(request);

  if (!sessionId) {
    return successResponse({ user: null, permissions: [] });
  }

  let auth = null;

  try {
    auth = await findActiveSession(prisma, sessionId);
  } catch (error) {
    console.error('[auth-session] Error al recuperar la sesión', error);
    return successResponse({ user: null, permissions: [] });
  }

  if (!auth) {
    const response = successResponse({ user: null, permissions: [] });
    return {
      ...response,
      headers: { ...response.headers, 'Set-Cookie': buildClearSessionCookie() },
    };
  }

  return successResponse({ user: serializeUser(auth.user), permissions: auth.permissions });
});
