import * as bcrypt from 'bcryptjs';
import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import { logAudit, type JsonValue } from './_shared/audit-log';
import {
  buildSessionCookie,
  getPermissionsForRole,
  getRoleDisplayValue,
  getSessionExpirationDate,
  hashIp,
  normalizeEmail,
  resolveClientIp,
} from './_shared/auth';

type AttemptRecord = {
  failures: number;
  firstFailure: number;
  blockedUntil: number | null;
  lastFailure: number;
};

const MAX_ATTEMPTS_PER_WINDOW = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const BLOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes after hitting the cap
const BACKOFF_BASE_MS = 1500;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

const attemptStore = new Map<string, AttemptRecord>();

function buildRateLimitKeys(email: string | null, ip: string | null): string[] {
  const keys = [] as string[];
  if (email) keys.push(`email:${email}`);
  keys.push(`ip:${ip ?? 'unknown'}`);
  return keys;
}

function resetAttempts(keys: string[]) {
  for (const key of keys) {
    attemptStore.delete(key);
  }
}

function registerFailure(keys: string[]) {
  const now = Date.now();
  for (const key of keys) {
    const existing = attemptStore.get(key);
    const withinWindow = existing && now - existing.firstFailure <= WINDOW_MS;
    const record: AttemptRecord = withinWindow
      ? existing!
      : { failures: 0, firstFailure: now, blockedUntil: null, lastFailure: now };

    record.failures += 1;
    record.lastFailure = now;

    const progressiveBackoff = Math.min(
      BACKOFF_BASE_MS * 2 ** Math.max(record.failures - 1, 0),
      MAX_BACKOFF_MS,
    );

    record.blockedUntil = Math.max(
      record.blockedUntil ?? 0,
      now + progressiveBackoff,
    );

    if (record.failures >= MAX_ATTEMPTS_PER_WINDOW) {
      record.blockedUntil = Math.max(record.blockedUntil ?? 0, now + BLOCK_DURATION_MS);
    }

    attemptStore.set(key, record);
  }
}

function resolveRateLimit(keys: string[]) {
  const now = Date.now();
  let blockedUntil: number | null = null;

  for (const key of keys) {
    const record = attemptStore.get(key);
    if (!record) continue;

    if (record.blockedUntil && record.blockedUntil > now) {
      blockedUntil = blockedUntil ? Math.max(blockedUntil, record.blockedUntil) : record.blockedUntil;
    } else if (now - record.firstFailure > WINDOW_MS) {
      attemptStore.delete(key);
    }
  }

  if (!blockedUntil) return { blocked: false } as const;
  const retryAfterSeconds = Math.max(1, Math.ceil((blockedUntil - now) / 1000));
  return { blocked: true as const, retryAfterSeconds };
}

function serializeUser(user: any) {
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    role: getRoleDisplayValue(user.role) ?? user.role,
    active: user.active,
    position: user.position,
  };
}

/**
 * Detección básica de algoritmo en función del prefijo del hash.
 * Permitimos explícitamente bcrypt ($2a, $2b, $2y). Otros → 400.
 */
function isSupportedHash(hash: string | null | undefined): boolean {
  if (!hash) return false;
  return /^\$2[aby]\$/.test(hash);
}

export const handler = createHttpHandler<any>(async (request) => {
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();

  const email = normalizeEmail((request.body as any)?.email);
  const password =
    typeof (request.body as any)?.password === 'string'
      ? (request.body as any).password
      : null;

  if (!email || !password) {
    return errorResponse('INVALID_CREDENTIALS', 'Email o contraseña inválidos', 400);
  }

  const clientIp = resolveClientIp(request);
  const rateLimitKeys = buildRateLimitKeys(email, clientIp);
  const rateLimitStatus = resolveRateLimit(rateLimitKeys);
  if (rateLimitStatus.blocked) {
    const baseResponse = errorResponse(
      'TOO_MANY_ATTEMPTS',
      'Demasiados intentos fallidos. Inténtalo de nuevo en unos minutos.',
      429,
    );

    return {
      ...baseResponse,
      headers: {
        ...(baseResponse.headers ?? {}),
        'Retry-After': String(rateLimitStatus.retryAfterSeconds),
      },
    };
  }

  // Buscar usuario por email (normalizado a lower en DB)
  const user = await prisma.users.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });

  // Mantenemos mensaje genérico para no filtrar existencia de usuarios
  if (!user || !user.active || !user.password_hash) {
    registerFailure(rateLimitKeys);

    await logAudit({
      userId: user?.id ?? null,
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: user?.id ?? email,
      before: null,
      after: { ip: clientIp ?? null, email } as JsonValue,
    });

    return errorResponse('INVALID_CREDENTIALS', 'Credenciales inválidas', 401);
  }

  // Validar algoritmo soportado (bcrypt) y comparar
  if (!isSupportedHash(user.password_hash)) {
    registerFailure(rateLimitKeys);

    await logAudit({
      userId: user.id,
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: user.id,
      before: null,
      after: { ip: clientIp ?? null, email, reason: 'unsupported_hash' } as JsonValue,
    });

    // Si en el futuro añadimos otros algoritmos, aquí se enruta.
    return errorResponse(
      'INVALID_CREDENTIALS',
      'Credenciales inválidas',
      401
    );
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    registerFailure(rateLimitKeys);

    await logAudit({
      userId: user.id,
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: user.id,
      before: null,
      after: { ip: clientIp ?? null, email } as JsonValue,
    });

    return errorResponse('INVALID_CREDENTIALS', 'Credenciales inválidas', 401);
  }

  // Crear sesión
  const expiresAt = getSessionExpirationDate();
  resetAttempts(rateLimitKeys);

  try {
    const session = await prisma.auth_sessions.create({
      data: {
        user_id: user.id,
        expires_at: expiresAt,
        ip_hash: hashIp(clientIp),
        user_agent: request.headers['user-agent'] ?? null,
      },
    });

    const permissions = getPermissionsForRole(user.role);

    try {
      await logAudit({
        userId: user.id,
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
        before: null,
        after: {
          session_id: session.id,
          expires_at: session.expires_at?.toISOString() ?? null,
          ip_hash: session.ip_hash,
          user_agent: session.user_agent,
        } as JsonValue,
      });
    } catch (auditError) {
      console.error('[auth-login] Failed to log login event', auditError);
    }

    // Devolvemos usuario + permisos y seteamos cookie HttpOnly
    return {
      ...successResponse({ user: serializeUser(user), permissions }),
      headers: {
        'Set-Cookie': buildSessionCookie(session.id, session.expires_at),
      },
    };
  } catch (err) {
  const e: any = err as any;
  console.error("[auth-login] session create error", {
    name: e?.name,
    message: e?.message,
    code: e?.code,
    meta: e?.meta
  });
  return errorResponse("INTERNAL", "No se pudo iniciar la sesión", 500);
}
});
