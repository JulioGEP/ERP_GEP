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

export type AttachResult<TBody> =
  | { request: AuthedHttpRequest<TBody> }
  | { error: ReturnType<typeof errorResponse> };

type ActiveSession = user_sessions & { user: users };

const SESSION_TOKEN_BYTES = 48;
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

function now(): Date {
  return new Date();
}

function parsePositiveInt(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function getSessionTtlMs(): number {
  const ttlSeconds = parsePositiveInt(process.env.SESSION_TTL_SECONDS) ?? DEFAULT_SESSION_TTL_SECONDS;
  return ttlSeconds * 1000;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function extractAuthToken(headers: Record<string, string> | undefined | null): string | null {
  if (!headers) return null;
  const raw = headers['authorization'] ?? headers['Authorization'];
  if (!raw) return null;

  const value = raw.trim();
  if (!value.length) return null;

  const bearerMatch = value.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) {
    const token = bearerMatch[1].trim();
    return token.length ? token : null;
  }

  return value;
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
): Promise<AttachResult<TBody>> {
  const token = extractAuthToken(request.headers);
  if (!token) {
    return {
      error: errorResponse('UNAUTHORIZED', 'Se requiere autenticación.', 401),
    };
  }

  const session = await findActiveSessionByToken(token);
  if (!session) {
    return {
      error: errorResponse('UNAUTHORIZED', 'Sesión inválida o expirada.', 401),
    };
  }

  const { user } = session;
  if (!user.active) {
    await revokeSessionById(session.id);
    return {
      error: errorResponse('USER_INACTIVE', 'El usuario no está activo.', 403),
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
