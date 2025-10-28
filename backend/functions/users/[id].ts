import type { Prisma } from '@prisma/client';
import { createHttpHandler } from '../_shared/http';
import { getPrisma } from '../_shared/prisma';
import {
  AUTH_USER_SELECT,
  hashPassword,
  normalizeEmail,
  normalizeString,
  requireUser,
  toApiUser,
} from '../_shared/auth';
import { COMMON_HEADERS, errorResponse } from '../_shared/response';

const ROLE_VALUES = new Set<Prisma.$Enums.erp_role>([
  'admin',
  'comercial',
  'administracion',
  'logistica',
  'people',
  'formador',
]);

const USER_SAFE_SELECT = {
  ...AUTH_USER_SELECT,
  created_at: true,
  updated_at: true,
} satisfies Prisma.usersSelect;

type SafeUser = Prisma.usersGetPayload<{ select: typeof USER_SAFE_SELECT }>;

type UpdateUserBody = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string;
  role?: Prisma.$Enums.erp_role;
  active?: boolean;
  password?: string | null;
};

function parseRole(value: unknown): Prisma.$Enums.erp_role | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase() as Prisma.$Enums.erp_role;
  return ROLE_VALUES.has(normalized) ? normalized : null;
}

function serializeUser(user: SafeUser) {
  const base = toApiUser(user);
  return {
    ...base,
    createdAt: user.created_at?.toISOString() ?? null,
    updatedAt: user.updated_at?.toISOString() ?? null,
  };
}

function extractId(path: string): string | null {
  const match = path.match(/\/users\/?([^/?#]+)/i);
  if (!match) return null;
  const id = decodeURIComponent(match[1] ?? '').trim();
  return id.length ? id : null;
}

export const handler = createHttpHandler<UpdateUserBody>(async (request) => {
  if (request.method !== 'PATCH') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
  }

  const id = extractId(request.path ?? '');
  if (!id) {
    return errorResponse('INVALID_ID', 'Identificador de usuario inválido.', 400);
  }

  const prisma = getPrisma();

  const auth = await requireUser(prisma, request.headers, { allowedRoles: ['admin'] });
  if ('statusCode' in auth) {
    return auth;
  }

  const body = request.body ?? {};
  const data: Prisma.usersUpdateInput = {};
  let shouldRevokeSessions = false;

  if ('firstName' in body) {
    data.first_name = normalizeString(body.firstName) ?? null;
  }

  if ('lastName' in body) {
    data.last_name = normalizeString(body.lastName) ?? null;
  }

  if ('email' in body) {
    const email = normalizeEmail(body.email);
    if (!email) {
      return errorResponse('INVALID_EMAIL', 'Debes indicar un correo electrónico válido.', 400);
    }
    data.email = email;
  }

  if ('role' in body) {
    const role = parseRole(body.role);
    if (!role) {
      return errorResponse('INVALID_ROLE', 'Debes seleccionar un rol válido.', 400);
    }
    data.role = role;
  }

  if ('active' in body) {
    data.active = Boolean(body.active);
    if (data.active === false) {
      shouldRevokeSessions = true;
    }
  }

  if ('password' in body) {
    const password = normalizeString(body.password);
    if (!password || password.length < 6) {
      return errorResponse(
        'INVALID_PASSWORD',
        'La nueva contraseña debe tener al menos 6 caracteres.',
        400,
      );
    }
    const hashed = await hashPassword(prisma, password);
    data.password_hash = hashed;
    data.password_algo = 'bcrypt';
    data.password_updated_at = new Date();
    data.reset_token = null;
    data.reset_token_expires = null;
    data.reset_used_at = new Date();
    shouldRevokeSessions = true;
  }

  if (Object.keys(data).length === 0) {
    return errorResponse('NO_CHANGES', 'No se proporcionaron cambios.', 400);
  }

  try {
    const user = await prisma.users.update({
      where: { id },
      data,
      select: USER_SAFE_SELECT,
    });

    if (shouldRevokeSessions) {
      await prisma.auth_sessions.updateMany({
        where: { user_id: id, revoked_at: null },
        data: { revoked_at: new Date() },
      });
    }

    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ ok: true, user: serializeUser(user as SafeUser) }),
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return errorResponse('EMAIL_IN_USE', 'Ya existe un usuario con ese correo.', 409);
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return errorResponse('NOT_FOUND', 'El usuario no existe.', 404);
    }

    console.error('[users/:id] Failed to update user', error);
    return errorResponse('UPDATE_FAILED', 'No se pudo actualizar el usuario.', 500);
  }
});
