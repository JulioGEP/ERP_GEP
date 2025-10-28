// backend/functions/auth/login.ts
import type { PrismaClient } from '@prisma/client';

import { createHttpHandler } from '../_shared/http';
import { getPrisma } from '../_shared/prisma';
import { errorResponse, successResponse } from '../_shared/response';
import {
  buildSessionCookie,
  buildUserDisplayName,
  createSession,
  ensurePgcrypto,
} from '../_lib/auth';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

interface UserRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
  active: boolean;
  password_hash: string | null;
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

async function fetchUserByEmail(
  prisma: PrismaClient,
  email: string,
): Promise<UserRow | null> {
  const users = await prisma.$queryRaw<UserRow[]>`
    SELECT id, first_name, last_name, email, role, active, password_hash
    FROM users
    WHERE lower(email) = lower(${email})
    LIMIT 1
  `;

  return users[0] ?? null;
}

async function verifyPassword(
  prisma: PrismaClient,
  userId: string,
  password: string,
): Promise<boolean> {
  const results = await prisma.$queryRaw<{ ok: boolean }[]>`
    SELECT crypt(${password}, password_hash) = password_hash AS ok
    FROM users
    WHERE id = ${userId}::uuid
      AND password_hash IS NOT NULL
    LIMIT 1
  `;

  return Boolean(results[0]?.ok);
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
  const pgcryptoReady = await ensurePgcrypto(prisma);

  if (!pgcryptoReady) {
    return errorResponse(
      'AUTH_CONFIGURATION_ERROR',
      'No se puede iniciar sesión en este momento. Inténtalo de nuevo más tarde.',
      500,
    );
  }

  const user = await fetchUserByEmail(prisma, email);

  if (!user || !user.active || !user.password_hash) {
    return errorResponse('INVALID_CREDENTIALS', 'Credenciales inválidas', 401);
  }

  const passwordMatches = await verifyPassword(prisma, user.id, password);

  if (!passwordMatches) {
    return errorResponse('INVALID_CREDENTIALS', 'Credenciales inválidas', 401);
  }

  const fallbackName = user.email?.split('@')[0] ?? user.email;
  const displayName = buildUserDisplayName(user.first_name, user.last_name, fallbackName);

  const publicUser = {
    id: user.id,
    name: displayName,
    email: user.email,
    role: user.role,
    active: user.active,
  };

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
