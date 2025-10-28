import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import {
  buildSessionCookie,
  getPermissionsForRole,
  getSessionExpirationDate,
  hashIp,
  normalizeEmail,
  resolveClientIp,
  verifyPassword,
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

export const handler = createHttpHandler<any>(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const email = normalizeEmail((request.body as any)?.email);
  const password = typeof (request.body as any)?.password === 'string'
    ? (request.body as any).password
    : null;

  if (!email || !password) {
    return errorResponse('INVALID_CREDENTIALS', 'Email o contraseña inválidos', 400);
  }

  const user = await prisma.users.findUnique({ where: { email } });

  if (!user || !user.active || !user.password_hash) {
    return errorResponse('INVALID_CREDENTIALS', 'Credenciales inválidas', 401);
  }

  let match = verifyPassword(password, user.password_hash);

  if (!match && user.password_algo !== 'bcrypt' && user.password_hash) {
    try {
      const [legacyMatch] = await prisma.$queryRaw<{ valid: boolean }[]>`
        SELECT crypt(${password}, ${user.password_hash}) = ${user.password_hash} AS valid
      `;
      match = Boolean(legacyMatch?.valid);
    } catch (error) {
      console.error('[auth-login] Failed to validate legacy password hash', error);
    }
  }

  if (!match) {
    return errorResponse('INVALID_CREDENTIALS', 'Credenciales inválidas', 401);
  }

  const expiresAt = getSessionExpirationDate();
  const clientIp = resolveClientIp(request);

  const session = await prisma.auth_sessions.create({
    data: {
      user_id: user.id,
      expires_at: expiresAt,
      ip_hash: hashIp(clientIp),
      user_agent: request.headers['user-agent'] ?? null,
    },
  });

  const permissions = getPermissionsForRole(user.role);

  return {
    ...successResponse({ user: serializeUser(user), permissions }),
    headers: {
      'Set-Cookie': buildSessionCookie(session.id, session.expires_at),
    },
  };
});
