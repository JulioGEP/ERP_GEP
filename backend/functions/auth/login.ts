// backend/functions/auth/login.ts
import { randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';

import { createHttpHandler } from '../_shared/http';
import { errorResponse, successResponse } from '../_shared/response';
import { getPrisma } from '../_shared/prisma';
import {
  buildSessionCookie,
  buildUserDisplayName,
  createSession,
  hashPassword,
  validatePassword,
} from '../_lib/auth';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

interface UserRecord {
  id: string;
  first_name: string | null;
  last_name: string | null;
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

function buildBootstrapDisplayName(email: string): string | null {
  const localPart = email.split('@')[0]?.trim() ?? '';
  if (!localPart) {
    return null;
  }

  const words = localPart
    .split(/[._-]+/)
    .map((part) => part.trim())
    .filter((part): part is string => Boolean(part && part.length))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());

  if (!words.length) {
    return null;
  }

  return words.join(' ');
}

async function bootstrapFirstUserIfEmpty(
  prisma: PrismaClient,
  email: string,
  password: string,
): Promise<UserRecord | null> {
  const existingUsers = await prisma.$queryRaw<{ has_users: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM users) AS has_users
  `;

  const hasUsersRaw = existingUsers[0]?.has_users;
  const hasUsers = typeof hasUsersRaw === 'boolean' ? hasUsersRaw : Boolean(hasUsersRaw);
  if (hasUsers) {
    return null;
  }

  const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase() ?? null;
  if (allowedDomain && !email.toLowerCase().endsWith(`@${allowedDomain}`)) {
    console.warn(
      `[auth] Ignorando arranque automático para ${email}: dominio no permitido (${allowedDomain})`,
    );
    return null;
  }

  const passwordValidation = validatePassword(password);
  if (!passwordValidation.ok) {
    console.warn(
      `[auth] Ignorando arranque automático para ${email}: contraseña no cumple requisitos (${passwordValidation.message})`,
    );
    return null;
  }

  try {
    const passwordHash = await hashPassword(password, prisma);
    const userId = randomUUID();
    const displayName = buildBootstrapDisplayName(email);
    const [firstName, lastName] = (() => {
      if (!displayName) return [null, null] as const;
      const parts = displayName
        .split(/\s+/)
        .map((part) => part.trim())
        .filter((part) => part.length);
      if (!parts.length) {
        return [null, null] as const;
      }
      const first = parts.shift() ?? null;
      const last = parts.length ? parts.join(' ') : null;
      return [first, last] as const;
    })();

    const createdUsers = await prisma.$queryRaw<UserRecord[]>`
      INSERT INTO users (
        id,
        email,
        role,
        active,
        password_hash,
        password_algo,
        password_updated_at,
        first_name,
        last_name
      )
      VALUES (
        ${userId}::uuid,
        ${email},
        'admin',
        true,
        ${passwordHash},
        'bcrypt',
        now(),
        ${firstName},
        ${lastName}
      )
      RETURNING id, first_name, last_name, email, role, active, password_hash, password_algo
    `;

    if (!createdUsers.length) {
      console.error('[auth] No se pudo crear el usuario administrador inicial');
      return null;
    }

    console.info(`[auth] Usuario administrador inicial creado para ${email}`);
    return createdUsers[0];
  } catch (error) {
    console.error('[auth] Error creando usuario administrador inicial', error);
    return null;
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
    SELECT id, first_name, last_name, email, role, active, password_hash, password_algo
    FROM users
    WHERE active = true
      AND password_hash IS NOT NULL
      AND lower(email) = lower(${email})
      AND password_hash = crypt(${password}, password_hash)
    LIMIT 1
  `;

  let user = users[0];

  if (!user) {
    user = await bootstrapFirstUserIfEmpty(prisma, email, password);
  }

  if (!user) {
    return errorResponse('INVALID_CREDENTIALS', 'Credenciales inválidas', 401);
  }

  await upgradePasswordHashIfNeeded(prisma, user, password);
  const { password_hash: _passwordHash, password_algo: _passwordAlgo, ...restUser } = user;

  const displayName =
    buildUserDisplayName(restUser.first_name, restUser.last_name, buildBootstrapDisplayName(restUser.email)) ?? null;

  const publicUser = {
    id: restUser.id,
    name: displayName,
    email: restUser.email,
    role: restUser.role,
    active: restUser.active,
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
