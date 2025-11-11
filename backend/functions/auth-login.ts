import * as bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import { logAudit } from './_shared/audit-log';
import {
  buildSessionCookie,
  getPermissionsForRole,
  getRoleDisplayValue,
  getSessionExpirationDate,
  hashIp,
  normalizeEmail,
  resolveClientIp,
} from './_shared/auth';

function serializeUser(user: any) {
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    role: getRoleDisplayValue(user.role) ?? user.role,
    active: user.active,
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

  // Buscar usuario por email (normalizado a lower en DB)
  const user = await prisma.users.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });

  // Mantenemos mensaje genérico para no filtrar existencia de usuarios
  if (!user || !user.active || !user.password_hash) {
    return errorResponse('INVALID_CREDENTIALS', 'Credenciales inválidas', 401);
  }

  // Validar algoritmo soportado (bcrypt) y comparar
  if (!isSupportedHash(user.password_hash)) {
    // Si en el futuro añadimos otros algoritmos, aquí se enruta.
    return errorResponse(
      'INVALID_CREDENTIALS',
      'Credenciales inválidas',
      401
    );
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return errorResponse('INVALID_CREDENTIALS', 'Credenciales inválidas', 401);
  }

  // Crear sesión
  const expiresAt = getSessionExpirationDate();
  const clientIp = resolveClientIp(request);

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
        } as Prisma.InputJsonValue,
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
