// backend/functions/auth/login.ts
import { createHttpHandler } from '../_shared/http';
import { errorResponse, successResponse } from '../_shared/response';
import { getPrisma } from '../_shared/prisma';
import { buildSessionCookie, createSession } from '../_lib/auth';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

interface UserRecord {
  id: string;
  name: string | null;
  email: string;
  role: string;
  active: boolean;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizePassword(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return value;
}

export const handler = createHttpHandler<LoginBody>(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const email = normalizeEmail(request.body?.email);
  const password = normalizePassword(request.body?.password);

  if (!email || !password) {
    return errorResponse('INVALID_CREDENTIALS', 'Credenciales inválidas', 401);
  }

  const prisma = getPrisma();

  const users = await prisma.$queryRaw<UserRecord[]>`
    SELECT id, name, email, role, active
    FROM users
    WHERE active = true
      AND password_hash IS NOT NULL
      AND password_algo = 'bcrypt'
      AND lower(email) = lower(${email})
      AND password_hash = crypt(${password}, password_hash)
    LIMIT 1
  `;

  if (!users.length) {
    return errorResponse('INVALID_CREDENTIALS', 'Credenciales inválidas', 401);
  }

  const user = users[0];
  const { sessionId, expiresAt } = await createSession(prisma, user.id, request.headers);
  const cookie = buildSessionCookie(sessionId, expiresAt);

  const response = successResponse({
    me: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
    },
  });

  return {
    ...response,
    headers: {
      ...response.headers,
      'Set-Cookie': cookie,
    },
  };
});
