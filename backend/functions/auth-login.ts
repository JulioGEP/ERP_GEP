import * as bcrypt from 'bcryptjs';
import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import {
  buildSessionCookie,
  getPermissionsForRole,
  getRoleDisplayValue,
  getRoleStorageValue,
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
  const roleInputRaw = typeof (request.body as any)?.role === 'string' ? (request.body as any).role : null;
  const roleInputNormalized = roleInputRaw ? roleInputRaw.trim() : '';

  if (!email || !password) {
    return errorResponse('INVALID_CREDENTIALS', 'Email o contraseña inválidos', 400);
  }

  const candidates = await prisma.users.findMany({
    where: { email: { equals: email, mode: 'insensitive' } },
    orderBy: { created_at: 'asc' },
  });

  type Candidate = (typeof candidates)[number];
  const matchingUsers: Candidate[] = [];

  for (const candidate of candidates) {
    if (!candidate.active || !candidate.password_hash) continue;
    if (!isSupportedHash(candidate.password_hash)) continue;
    const match = await bcrypt.compare(password, candidate.password_hash);
    if (match) {
      matchingUsers.push(candidate);
    }
  }

  if (matchingUsers.length === 0) {
    return errorResponse('INVALID_CREDENTIALS', 'Credenciales inválidas', 401);
  }

  const roleOptionsMap = new Map<string, { value: string; label: string }>();
  for (const user of matchingUsers) {
    if (!roleOptionsMap.has(user.role)) {
      roleOptionsMap.set(user.role, {
        value: user.role,
        label: getRoleDisplayValue(user.role) ?? user.role,
      });
    }
  }

  const roleOptions = Array.from(roleOptionsMap.values());

  const requestedRoleStorage = roleInputNormalized.length ? getRoleStorageValue(roleInputNormalized) : null;
  const requestedRoleNormalized = roleInputNormalized.toLowerCase();

  let user: Candidate = matchingUsers[0]!;

  if (roleOptions.length > 1) {
    if (roleInputNormalized.length) {
      user =
        matchingUsers.find((candidate) => candidate.role === requestedRoleStorage) ||
        matchingUsers.find((candidate) => {
          const display = getRoleDisplayValue(candidate.role);
          return display?.toLowerCase() === requestedRoleNormalized;
        }) ||
        matchingUsers.find((candidate) => candidate.role.toLowerCase() === requestedRoleNormalized);

      if (!user) {
        return errorResponse('INVALID_ROLE_SELECTION', 'El rol seleccionado no es válido', 400, {
          roles: roleOptions,
        });
      }
    } else {
      return errorResponse('MULTIPLE_ROLES', 'Selecciona un rol para continuar', 409, {
        roles: roleOptions,
      });
    }
  } else {
    user = matchingUsers[0];
    if (roleInputNormalized.length) {
      const matchesRequested =
        user.role === requestedRoleStorage ||
        getRoleDisplayValue(user.role)?.toLowerCase() === requestedRoleNormalized ||
        user.role.toLowerCase() === requestedRoleNormalized;
      if (!matchesRequested) {
        return errorResponse('INVALID_ROLE_SELECTION', 'El rol seleccionado no es válido', 400, {
          roles: roleOptions,
        });
      }
    }
  }

  if (!user || !user.active) {
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
