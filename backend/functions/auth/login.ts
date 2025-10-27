// backend/functions/auth/login.ts
import type { PrismaClient } from '@prisma/client';

import { createHttpHandler } from '../_shared/http';
import { errorResponse, successResponse } from '../_shared/response';
import { getPrisma } from '../_shared/prisma';
import { buildSessionCookie, createSession, hashPassword } from '../_lib/auth';

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
  password_hash: string;
  password_algo: string | null;
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

function isBcryptAlgorithm(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return value.trim().toLowerCase() === 'bcrypt';
}

function isBcryptHash(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return /^\$2[aby]\$/.test(value);
}

async function upgradePasswordHashIfNeeded(
  prisma: PrismaClient,
  user: UserRecord,
  plainPassword: string,
): Promise<void> {
  if (!plainPassword || !user?.id) {
    return;
  }

  const currentHash = user.password_hash;
  const currentAlgo = user.password_algo;

  if (isBcryptAlgorithm(currentAlgo) && isBcryptHash(currentHash)) {
    return;
  }

  try {
    const newHash = await hashPassword(plainPassword, prisma);
    await prisma.$executeRaw`
      UPDATE users
      SET password_hash = ${newHash},
          password_algo = 'bcrypt',
          password_updated_at = now(),
          updated_at = now()
      WHERE id = ${user.id}::uuid
    `;
  } catch (error) {
    console.error('[auth] Failed to upgrade password hash', user.id, error);
  }
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
    SELECT id, name, email, role, active, password_hash, password_algo
    FROM users
    WHERE active = true
      AND password_hash IS NOT NULL
      AND lower(email) = lower(${email})
      AND password_hash = crypt(${password}, password_hash)
    LIMIT 1
  `;

  if (!users.length) {
    return errorResponse('INVALID_CREDENTIALS', 'Credenciales inválidas', 401);
  }

  const user = users[0];
  await upgradePasswordHashIfNeeded(prisma, user, password);
  const { password_hash: _passwordHash, password_algo: _passwordAlgo, ...publicUser } = user;

  const { sessionId, expiresAt } = await createSession(prisma, publicUser.id, request.headers);
  const cookie = buildSessionCookie(sessionId, expiresAt);

  const response = successResponse({
    me: {
      id: publicUser.id,
      name: publicUser.name,
      email: publicUser.email,
      role: publicUser.role,
      active: publicUser.active,
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
