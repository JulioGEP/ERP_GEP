// backend/functions/_lib/auth.ts
import { randomBytes, randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';

import { json } from './http';
import type { HttpRequest } from '../_shared/http';
import { getPrisma } from '../_shared/prisma';

const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 días
const MIN_SESSION_TTL_SECONDS = 60 * 10; // 10 minutos para evitar caducidades ridículas

let pgcryptoReady: boolean | null = null;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function isUuid(value: string): boolean {
  return /^[0-9a-fA-F-]{36}$/.test(value.trim());
}

const SESSION_COOKIE_NAME = process.env.AUTH_SESSION_COOKIE ?? 'erp_session';
const SESSION_COOKIE_DOMAIN = process.env.AUTH_COOKIE_DOMAIN?.trim() || null;
const SESSION_SAMESITE = (process.env.AUTH_COOKIE_SAMESITE || 'Lax').trim();
const SESSION_TTL_SECONDS = Math.max(
  MIN_SESSION_TTL_SECONDS,
  parsePositiveInt(process.env.AUTH_SESSION_TTL_SECONDS, DEFAULT_SESSION_TTL_SECONDS),
);

export function buildUserDisplayName(
  firstName?: string | null,
  lastName?: string | null,
  fallback?: string | null,
): string | null {
  const parts = [firstName, lastName]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value): value is string => Boolean(value));

  if (parts.length) {
    return parts.join(' ');
  }

  if (typeof fallback === 'string') {
    const trimmedFallback = fallback.trim();
    if (trimmedFallback.length) {
      return trimmedFallback;
    }
  }

  return null;
}

export interface AuthenticatedUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  active: boolean;
}

export interface ActiveSession {
  id: string;
  userId: string;
  expiresAt: Date | null;
}

export class AuthError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function resolveClientIp(headers: Record<string, string>): string | null {
  const forwarded = headers['x-forwarded-for'] || headers['client-ip'] || headers['true-client-ip'];
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const remoteAddr = headers['remote-addr'] || headers['x-real-ip'];
  return remoteAddr ? remoteAddr.trim() || null : null;
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }
  return header.split(';').reduce<Record<string, string>>((acc, part) => {
    const [rawName, ...rest] = part.split('=');
    if (!rawName) {
      return acc;
    }
    const name = rawName.trim();
    if (!name) {
      return acc;
    }
    const value = rest.join('=').trim();
    acc[name] = value;
    return acc;
  }, {});
}

function getSessionCookieValue(headers: Record<string, string>): string | null {
  const cookies = parseCookies(headers['cookie']);
  const value = cookies[SESSION_COOKIE_NAME];
  return value ? value : null;
}

function computeSessionExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
}

export function buildSessionCookie(sessionId: string, expiresAt: Date): string {
  const parts = [`${SESSION_COOKIE_NAME}=${sessionId}`, 'Path=/', 'HttpOnly', 'Secure'];
  const sameSite = SESSION_SAMESITE || 'Lax';
  parts.push(`SameSite=${sameSite}`);
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  parts.push(`Max-Age=${maxAge}`);
  parts.push(`Expires=${expiresAt.toUTCString()}`);
  if (SESSION_COOKIE_DOMAIN) {
    parts.push(`Domain=${SESSION_COOKIE_DOMAIN}`);
  }
  return parts.join('; ');
}

export function buildClearSessionCookie(): string {
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=0', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT'];
  if (SESSION_COOKIE_DOMAIN) {
    parts.push(`Domain=${SESSION_COOKIE_DOMAIN}`);
  }
  return parts.join('; ');
}

type SessionUserRow = {
  session_id: string;
  expires_at: Date | null;
  revoked_at: Date | null;
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
  active: boolean;
};

async function fetchAuthenticatedUser(
  prisma: PrismaClient,
  sessionId: string,
): Promise<(AuthenticatedUser & { session_id: string; expires_at: Date | null }) | null> {
  const results = await prisma.$queryRaw<SessionUserRow[]>`
    SELECT
      s.id as session_id,
      s.expires_at,
      s.revoked_at,
      u.id,
      u.first_name,
      u.last_name,
      u.email,
      u.role,
      u.active
    FROM auth_sessions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.id = ${sessionId}
    LIMIT 1
  `;

  if (!results.length) {
    return null;
  }

  const record = results[0];
  if (record.revoked_at) {
    return null;
  }

  if (record.expires_at && record.expires_at.getTime() <= Date.now()) {
    return null;
  }

  if (!record.active) {
    return null;
  }

  const fallbackName = record.email?.split('@')[0] ?? record.email ?? null;

  return {
    session_id: record.session_id,
    expires_at: record.expires_at,
    id: record.id,
    name: buildUserDisplayName(record.first_name, record.last_name, fallbackName),
    email: record.email,
    role: record.role,
    active: record.active,
  };
}

export async function createSession(
  prisma: PrismaClient,
  userId: string,
  headers: Record<string, string>,
): Promise<{ sessionId: string; expiresAt: Date }> {
  const sessionId = randomUUID();
  const expiresAt = computeSessionExpiry();
  const ipAddress = resolveClientIp(headers);
  const userAgent = headers['user-agent'] || null;

  await prisma.$executeRaw`
    INSERT INTO auth_sessions (id, user_id, ip_address, user_agent, expires_at, last_used_at)
    VALUES (${sessionId}::uuid, ${userId}::uuid, ${ipAddress}, ${userAgent}, ${expiresAt}, now())
  `;

  return { sessionId, expiresAt };
}

export async function destroySession(prisma: PrismaClient, sessionId: string): Promise<void> {
  if (!isUuid(sessionId)) {
    return;
  }
  await prisma.$executeRaw`
    DELETE FROM auth_sessions WHERE id = ${sessionId}::uuid
  `;
}

export async function invalidateUserSessions(
  prisma: PrismaClient,
  userId: string,
): Promise<void> {
  if (!isUuid(userId)) {
    return;
  }
  await prisma.$executeRaw`
    DELETE FROM auth_sessions WHERE user_id = ${userId}::uuid
  `;
}

export async function requireAuth(
  prisma: PrismaClient,
  request: HttpRequest<any>,
): Promise<{ user: AuthenticatedUser; session: ActiveSession; sessionCookie?: string }>
export async function requireAuth(
  prisma: PrismaClient,
  request: HttpRequest<any>,
  options: { allowMissing?: false },
): Promise<{ user: AuthenticatedUser; session: ActiveSession; sessionCookie?: string }>
export async function requireAuth(
  prisma: PrismaClient,
  request: HttpRequest<any>,
  options: { allowMissing: true },
): Promise<{ user: AuthenticatedUser; session: ActiveSession; sessionCookie?: string } | null>
export async function requireAuth(
  prisma: PrismaClient,
  request: HttpRequest<any>,
  options: { allowMissing?: boolean } = {},
): Promise<{ user: AuthenticatedUser; session: ActiveSession; sessionCookie?: string } | null> {
  const sessionId = getSessionCookieValue(request.headers);
  if (!sessionId) {
    if (options.allowMissing) {
      return null;
    }
    throw new AuthError('UNAUTHORIZED', 'No autenticado', 401);
  }

  if (!isUuid(sessionId)) {
    if (options.allowMissing) {
      return null;
    }
    throw new AuthError('UNAUTHORIZED', 'Sesión no válida', 401);
  }

  const record = await fetchAuthenticatedUser(prisma, sessionId);
  if (!record) {
    await destroySession(prisma, sessionId).catch(() => {});
    if (options.allowMissing) {
      return null;
    }
    throw new AuthError('UNAUTHORIZED', 'Sesión no válida', 401);
  }

  const expiresAt = record.expires_at ?? computeSessionExpiry();

  await prisma.$executeRaw`
    UPDATE auth_sessions
    SET last_used_at = now(), updated_at = now(), expires_at = ${expiresAt}
    WHERE id = ${sessionId}::uuid
  `;

  const sessionCookie = buildSessionCookie(sessionId, expiresAt);

  return {
    user: {
      id: record.id,
      name: record.name,
      email: record.email,
      role: record.role,
      active: record.active,
    },
    session: {
      id: sessionId,
      userId: record.id,
      expiresAt,
    },
    sessionCookie,
  };
}

export async function requireRole(
  prisma: PrismaClient,
  request: HttpRequest<any>,
  roles: readonly string[],
) {
  const auth = await requireAuth(prisma, request);
  if (!roles.includes(auth.user.role)) {
    throw new AuthError('FORBIDDEN', 'No autorizado', 403);
  }
  return auth;
}

export function unauthorizedResponse(message = 'No autorizado') {
  return json({ ok: false, error_code: 'UNAUTHORIZED', message }, 401);
}

export function forbiddenResponse(message = 'No autorizado') {
  return json({ ok: false, error_code: 'FORBIDDEN', message }, 403);
}

export function validatePassword(password: string): { ok: true } | { ok: false; message: string } {
  if (password.length < 8) {
    return { ok: false, message: 'La contraseña debe tener al menos 8 caracteres' };
  }
  if (password.length > 128) {
    return { ok: false, message: 'La contraseña es demasiado larga' };
  }
  return { ok: true };
}

export function generateResetToken(): string {
  return randomBytes(32).toString('hex');
}

export async function ensurePgcrypto(prismaClient: PrismaClient = getPrisma()): Promise<boolean> {
  if (pgcryptoReady === true) {
    return true;
  }

  try {
    await prismaClient.$executeRaw`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
    pgcryptoReady = true;
    return true;
  } catch (error) {
    if (pgcryptoReady !== false) {
      console.error('[auth] No se pudo inicializar la extensión pgcrypto', error);
    }
    pgcryptoReady = false;
    return false;
  }
}

export async function hashPassword(
  password: string,
  prismaClient: PrismaClient = getPrisma(),
): Promise<string> {
  const pgcryptoAvailable = await ensurePgcrypto(prismaClient);
  if (!pgcryptoAvailable) {
    throw new Error('PGCRYPTO_EXTENSION_UNAVAILABLE');
  }

  const rows = await prismaClient.$queryRaw<{ hash: string }[]>`
    SELECT crypt(${password}, gen_salt('bf')) AS hash
  `;

  if (!rows.length || !rows[0]?.hash) {
    throw new Error('HASH_GENERATION_FAILED');
  }

  return rows[0].hash;
}
