import { createHttpHandler } from '../_shared/http';
import { getPrisma } from '../_shared/prisma';
import {
  createExpiredSessionCookie,
  createSessionCookie,
  getRequestUser,
  sessionExpiryDate,
  toApiUser,
} from '../_shared/auth';
import { COMMON_HEADERS, errorResponse } from '../_shared/response';

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
  }

  const prisma = getPrisma();
  const result = await getRequestUser(prisma, request.headers);

  if (!result) {
    const response = errorResponse('UNAUTHENTICATED', 'Sesión no válida o expirada.', 401);
    return {
      ...response,
      headers: {
        ...(response.headers ?? COMMON_HEADERS),
        'Set-Cookie': createExpiredSessionCookie(),
      },
    };
  }

  const { user, session } = result;

  if (user.role === 'formador') {
    return errorResponse(
      'ROLE_NOT_SUPPORTED',
      'El perfil de Formador no tiene acceso al ERP todavía.',
      403,
    );
  }

  let cookie: string | null = null;
  try {
    await prisma.auth_sessions.update({
      where: { id: session.id },
      data: { expires_at: sessionExpiryDate() },
    });
    cookie = createSessionCookie(session.id);
  } catch (error) {
    console.error('[auth/session] Failed to refresh session expiry', error);
  }

  return {
    statusCode: 200,
    headers: {
      ...COMMON_HEADERS,
      ...(cookie ? { 'Set-Cookie': cookie } : {}),
    },
    body: JSON.stringify({ ok: true, user: toApiUser(user) }),
  };
});
