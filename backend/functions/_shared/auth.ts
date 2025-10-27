import type { users } from '@prisma/client';

import type { HttpRequest } from './http';
import { getPrisma } from './prisma';
import { errorResponse } from './response';
import { ROLE_PERMISSIONS, type RolePermissions, type UserRole } from './permissions';

export type CurrentUser = users;

export type AuthedHttpRequest<TBody = unknown> = HttpRequest<TBody> & {
  currentUser: CurrentUser;
  currentPermissions: RolePermissions;
};

const DEFAULT_CURRENT_USER_EMAIL = 'julio@gepgroup.es';

function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const email = value.trim().toLowerCase();
  return email.length ? email : null;
}

async function findCurrentUserByEmail(email: string) {
  const prisma = getPrisma();
  return prisma.users.findFirst({
    where: {
      email: { equals: email, mode: 'insensitive' },
    },
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

  const authedRequest: AuthedHttpRequest<TBody> = Object.assign({}, request, {
    currentUser: user,
    currentPermissions: permissions,
  });

  return { request: authedRequest };
}

export async function requireRole<TBody>(
  request: HttpRequest<TBody>,
  allowedRoles: readonly UserRole[],
): Promise<{ request: AuthedHttpRequest<TBody> } | { error: ReturnType<typeof errorResponse> }> {
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
