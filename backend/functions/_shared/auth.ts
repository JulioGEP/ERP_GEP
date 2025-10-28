import { randomBytes } from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { errorResponse } from './response';
import { prisma } from './prisma';

export const SESSION_COOKIE_NAME = 'erp_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 días
const RESET_TOKEN_TTL_SECONDS = 60 * 60; // 1 hora

const COOKIE_SECURE =
  process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';

export const AUTH_USER_SELECT = {
  id: true,
  first_name: true,
  last_name: true,
  email: true,
  role: true,
  active: true,
  password_hash: true,
  password_algo: true,
  password_updated_at: true,
} satisfies Prisma.usersSelect;

export type DatabaseUser = Prisma.usersGetPayload<{ select: typeof AUTH_USER_SELECT }>;

export type SessionWithUser = Prisma.auth_sessionsGetPayload<{
  include: { user: { select: typeof AUTH_USER_SELECT } };
}>;

export type ApiUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role: Prisma.$Enums.erp_role;
  active: boolean;
};

export function toApiUser(user: DatabaseUser): ApiUser {
  return {
    id: user.id,
    firstName: user.first_name ?? null,
    lastName: user.last_name ?? null,
    email: user.email,
    role: user.role,
    active: user.active,
  };
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  return trimmed.toLowerCase();
}

export function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function serializeCookie(name: string, value: string, options: { maxAge?: number; expires?: Date; }) {
  const encodedValue = encodeURIComponent(value);
  const segments = [`${name}=${encodedValue}`];
  segments.push('Path=/');
  segments.push('HttpOnly');
  segments.push('SameSite=Lax');
  if (COOKIE_SECURE) {
    segments.push('Secure');
  }
  if (typeof options.maxAge === 'number') {
    segments.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }
  if (options.expires instanceof Date) {
    segments.push(`Expires=${options.expires.toUTCString()}`);
  }
  return segments.join('; ');
}

export function createSessionCookie(sessionId: string): string {
  return serializeCookie(SESSION_COOKIE_NAME, sessionId, {
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function sessionExpiryDate(): Date {
  return new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
}

export function createExpiredSessionCookie(): string {
  return serializeCookie(SESSION_COOKIE_NAME, '', {
    maxAge: 0,
    expires: new Date(0),
  });
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const entries = header.split(';');
  const cookies: Record<string, string> = {};
  for (const entry of entries) {
    const [rawKey, ...rest] = entry.split('=');
    if (!rawKey) continue;
    const key = rawKey.trim();
    const value = rest.join('=').trim();
    if (!key.length) continue;
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export function getSessionIdFromHeaders(headers: Record<string, string>): string | null {
  const cookieHeader = headers['cookie'] ?? headers['Cookie'] ?? headers['COOKIE'];
  if (!cookieHeader) return null;
  const cookies = parseCookies(cookieHeader);
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (!sessionId) return null;
  return sessionId.trim().length ? sessionId.trim() : null;
}

export async function findActiveSession(
  client: PrismaClient,
  sessionId: string,
): Promise<SessionWithUser | null> {
  if (!sessionId) return null;
  try {
    const session = await client.auth_sessions.findFirst({
      where: {
        id: sessionId,
        revoked_at: null,
        OR: [
          { expires_at: null },
          { expires_at: { gt: new Date() } },
        ],
      },
      include: {
        user: {
          select: AUTH_USER_SELECT,
        },
      },
    });

    if (!session || !session.user) {
      return null;
    }

    if (!session.user.active) {
      return null;
    }

    return session;
  } catch (error) {
    console.error('[auth] Failed to load session', error);
    return null;
  }
}

export async function getRequestUser(
  client: PrismaClient,
  headers: Record<string, string>,
): Promise<{ session: SessionWithUser; user: DatabaseUser } | null> {
  const sessionId = getSessionIdFromHeaders(headers);
  if (!sessionId) return null;
  const session = await findActiveSession(client, sessionId);
  if (!session) return null;
  return { session, user: session.user };
}

export async function requireUser(
  client: PrismaClient,
  headers: Record<string, string>,
  options?: { allowedRoles?: Prisma.$Enums.erp_role[] },
): Promise<{ session: SessionWithUser; user: DatabaseUser } | ReturnType<typeof errorResponse>> {
  const result = await getRequestUser(client, headers);
  if (!result) {
    return errorResponse('UNAUTHENTICATED', 'Sesión no válida o expirada.', 401);
  }

  if (options?.allowedRoles && !options.allowedRoles.includes(result.user.role)) {
    return errorResponse('FORBIDDEN', 'No tienes permisos para realizar esta acción.', 403);
  }

  if (result.user.role === 'formador') {
    return errorResponse(
      'ROLE_NOT_SUPPORTED',
      'El perfil de Formador no tiene acceso al ERP todavía.',
      403,
    );
  }

  return result;
}

export async function hashPassword(client: PrismaClient, password: string): Promise<string> {
  try {
    const result = await client.$queryRaw<{ hash: string }[]>`
      SELECT crypt(${password}, gen_salt('bf', 12)) AS hash
    `;
    const hashValue = result?.[0]?.hash;
    if (!hashValue) {
      throw new Error('HASH_PASSWORD_FAILED');
    }
    return hashValue;
  } catch (error) {
    console.error('[auth] Failed to hash password', error);
    throw error;
  }
}

export async function verifyPassword(
  client: PrismaClient,
  password: string,
  hashValue: string | null | undefined,
) {
  if (!hashValue || !hashValue.trim().length) {
    return false;
  }

  try {
    const result = await client.$queryRaw<{ matches: boolean }[]>`
      SELECT crypt(${password}, ${hashValue}) = ${hashValue} AS matches
    `;
    return Boolean(result?.[0]?.matches);
  } catch (error) {
    console.error('[auth] Failed to verify password', error);
    return false;
  }
}

export function createResetToken(): string {
  return randomBytes(32).toString('hex');
}

export function resetTokenExpiryDate(): Date {
  return new Date(Date.now() + RESET_TOKEN_TTL_SECONDS * 1000);
}

type RequestHeaders = Record<string, string | string[] | undefined> | undefined;

function normalizeHeaders(headers: RequestHeaders): Record<string, string> {
  if (!headers) return {};
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!key) continue;
    if (typeof value === 'string') {
      normalized[key] = value;
    } else if (Array.isArray(value)) {
      normalized[key] = value.join(', ');
    }
  }
  return normalized;
}

export type SessionCookieUser = {
  id: string;
  email: string;
  role: Prisma.$Enums.erp_role;
  name?: string | null;
};

export async function signSessionCookie(user: SessionCookieUser): Promise<string> {
  const session = await prisma.auth_sessions.create({
    data: {
      user_id: user.id,
      expires_at: sessionExpiryDate(),
    },
  });

  return createSessionCookie(session.id);
}

export async function getSessionFromCookie(
  event: { headers?: Record<string, string | string[] | undefined> },
): Promise<SessionCookieUser | null> {
  const headers = normalizeHeaders(event.headers);
  const sessionId = getSessionIdFromHeaders(headers);
  if (!sessionId) return null;

  const session = await findActiveSession(prisma, sessionId);
  if (!session) return null;

  const user = session.user;
  const displayName =
    (user as any).name ?? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    name: displayName || null,
  };
}
