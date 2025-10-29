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

  try {
    const sessionId = extractSessionIdFromRequest(request);

    // Sin cookie -> sesión no iniciada
    if (!sessionId) {
      return {
        ...successResponse({ user: null, permissions: [] }),
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
      };
    }

    const auth = await findActiveSession(prisma, sessionId);

    // Sesión inválida/expirada -> devolvemos user null y limpiamos cookie
    if (!auth) {
      return {
        ...successResponse({ user: null, permissions: [] }),
        headers: {
          'Set-Cookie': buildClearSessionCookie(),
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
      };
    }

    // OK
    return {
      ...successResponse({ user: serializeUser(auth.user), permissions: auth.permissions }),
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      },
    };
  } catch (_err) {
    // No exponemos detalles internos
    return errorResponse('INTERNAL', 'No se pudo validar la sesión', 500);
  }
});
