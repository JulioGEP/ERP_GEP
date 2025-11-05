import { createHttpHandler, setRefreshSessionCookie } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import {
  buildClearSessionCookie,
  extractSessionIdFromRequest,
  findActiveSession,
  getRoleDisplayValue,
} from './_shared/auth';

function serializeUser(user: any) {
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    role: getRoleDisplayValue(user.role) ?? user.role,
    active: user.active,
  };
}

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();

  try {
    const sessionId = extractSessionIdFromRequest(request);

    // Sin cookie -> 401 (no hay sesión)
    if (!sessionId) {
      const res = errorResponse('UNAUTHORIZED', 'No hay sesión', 401);
      return {
        ...res,
        headers: {
          ...res.headers,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
      };
    }

    const auth = await findActiveSession(prisma, sessionId);

    // Sesión inválida/expirada -> 401 y limpiamos cookie
    if (!auth) {
      const res = errorResponse('UNAUTHORIZED', 'Sesión inválida o expirada', 401);
      return {
        ...res,
        headers: {
          ...res.headers,
          'Set-Cookie': buildClearSessionCookie(),
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
      };
    }

    if (auth.refreshedCookie) {
      setRefreshSessionCookie(request, auth.refreshedCookie);
    }

    // OK -> devolvemos usuario y permisos
    const ok = successResponse({
      user: serializeUser(auth.user),
      permissions: auth.permissions,
    });

    return {
      ...ok,
      headers: {
        ...ok.headers,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      },
    };
  } catch (_err) {
    // No exponemos detalles internos
    return errorResponse('INTERNAL', 'No se pudo validar la sesión', 500);
  }
});
