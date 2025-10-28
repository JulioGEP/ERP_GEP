import { createHttpHandler } from '../_shared/http';
import { getPrisma } from '../_shared/prisma';
import {
  AUTH_USER_SELECT,
  createSessionCookie,
  normalizeEmail,
  sessionExpiryDate,
  toApiUser,
  verifyPassword,
} from '../_shared/auth';
import { COMMON_HEADERS, errorResponse } from '../_shared/response';

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
  }

  const prisma = getPrisma();
  const body = request.body ?? {};

  const email = normalizeEmail((body as any).email);
  const password = typeof (body as any).password === 'string' ? (body as any).password : '';

  if (!email || !password.length) {
    return errorResponse('INVALID_CREDENTIALS', 'Credenciales inválidas.', 400);
  }

  const user = await prisma.users.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: AUTH_USER_SELECT,
  });

  if (!user) {
    return errorResponse('INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.', 401);
  }

  if (!user.active) {
    return errorResponse(
      'USER_INACTIVE',
      'Tu usuario está desactivado. Ponte en contacto con un administrador.',
      403,
    );
  }

  if (user.role === 'formador') {
    return errorResponse(
      'ROLE_NOT_SUPPORTED',
      'El perfil de Formador no tiene acceso al ERP todavía.',
      403,
    );
  }

  const isValidPassword = await verifyPassword(prisma, password, user.password_hash ?? null);
  if (!isValidPassword) {
    return errorResponse('INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.', 401);
  }

  const session = await prisma.auth_sessions.create({
    data: {
      user_id: user.id,
      expires_at: sessionExpiryDate(),
    },
  });

  const cookie = createSessionCookie(session.id);

  return {
    statusCode: 200,
    headers: {
      ...COMMON_HEADERS,
      'Set-Cookie': cookie,
    },
    body: JSON.stringify({ ok: true, user: toApiUser(user) }),
  };
});
