import { createHash, randomBytes } from 'crypto';
import type { user_sessions, users } from '@prisma/client';

import type { HttpRequest } from './http';
import { getPrisma } from './prisma';
import { errorResponse } from './response';
import { ROLE_PERMISSIONS, type RolePermissions, type UserRole } from './permissions';

export type CurrentUser = users;

export type AuthedHttpRequest<TBody = unknown> = HttpRequest<TBody> & {
  currentUser: CurrentUser;
  currentPermissions: RolePermissions;
};

const SESSION_TOKEN_BYTES = 48;
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const email = value.trim().toLowerCase();
  return email.length ? email : null;
}

async function findActiveSessionByToken(token: string): Promise<ActiveSession | null> {
  const prisma = getPrisma();
  const tokenHash = hashSessionToken(token);
  return prisma.user_sessions.findFirst({
    where: {
      token_hash: tokenHash,
      revoked_at: null,
      expires_at: { gt: now() },
    },
    include: { user: true },
  });
}

async function touchSession(sessionId: string) {
  const prisma = getPrisma();
  try {
    await prisma.user_sessions.update({
      where: { id: sessionId },
      data: { last_seen_at: now() },
    });
  } catch (error) {
    console.warn('[auth] No se pudo actualizar last_seen_at de la sesión', error);
  }
}

async function revokeSessionById(sessionId: string) {
  const prisma = getPrisma();
  await prisma.user_sessions.updateMany({
    where: { id: sessionId, revoked_at: null },
    data: { revoked_at: now() },
  });
}

export async function createUserSession(
  userId: string,
  options?: { ttlMs?: number },
): Promise<{ token: string; session: user_sessions }> {
  const prisma = getPrisma();
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(now().getTime() + (options?.ttlMs ?? getSessionTtlMs()));
  const session = await prisma.user_sessions.create({
    data: {
      user_id: userId,
      token_hash: hashSessionToken(token),
      expires_at: expiresAt,
      last_seen_at: now(),
    },
  });
  return { token, session };
}

export async function revokeUserSession(token: string): Promise<void> {
  const prisma = getPrisma();
  const tokenHash = hashSessionToken(token);
  await prisma.user_sessions.updateMany({
    where: { token_hash: tokenHash, revoked_at: null },
    data: { revoked_at: now() },
  });
}

export async function attachCurrentUser<TBody>(
  request: HttpRequest<TBody>,
): Promise<{ request: AuthedHttpRequest<TBody> } | { error: ReturnType<typeof errorResponse> }> {
  const resolvedEmail =
    normalizeEmail(process.env.CURRENT_USER_EMAIL) ?? normalizeEmail(DEFAULT_CURRENT_USER_EMAIL);

  if (!resolvedEmail) {
    return {
      error: errorResponse(
        'CURRENT_USER_MISSING',
        'No se pudo determinar el usuario actual (CURRENT_USER_EMAIL no configurado).',
        401,
      ),
    };
  }

  const user = await findCurrentUserByEmail(resolvedEmail);
  if (!user || !user.active) {
    return {
      error: errorResponse(
        'CURRENT_USER_NOT_FOUND',
        `No existe un usuario activo con email ${resolvedEmail}.`,
        401,
      ),
    };
  }

  const permissions = ROLE_PERMISSIONS[user.role as UserRole];
  if (!permissions) {
    return {
      error: errorResponse(
        'ROLE_NOT_ALLOWED',
        'El rol del usuario actual no tiene permisos configurados.',
        403,
      ),
    };
  }

  await touchSession(session.id);

  const authedRequest: AuthedHttpRequest<TBody> = Object.assign({}, request, {
    currentUser: user,
    currentPermissions: permissions,
  });

  return { request: authedRequest };
}

export async function requireRole<TBody>(
  request: HttpRequest<TBody>,
  allowedRoles: readonly UserRole[],
): Promise<AttachResult<TBody>> {
  const authed = await attachCurrentUser(request);
  if ('error' in authed) {
    return authed;
  }

  if (!allowedRoles.includes(authed.request.currentUser.role as UserRole)) {
    return {
      error: errorResponse('FORBIDDEN', 'No autorizado para realizar esta acción.', 403),
    };
  }

  return authed;
}

export function serializeUser(user: users) {
  return {
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    role: user.role,
    active: user.active,
    created_at: user.created_at instanceof Date ? user.created_at.toISOString() : user.created_at,
    updated_at: user.updated_at instanceof Date ? user.updated_at.toISOString() : user.updated_at,
  };
}
