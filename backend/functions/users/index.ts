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

type CreateUserBody = {
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: Prisma.$Enums.erp_role;
  password?: string;
  active?: boolean;
};

function serializeUser(user: SafeUser) {
  const base = toApiUser(user);
  return {
    ...base,
    createdAt: user.created_at?.toISOString() ?? null,
    updatedAt: user.updated_at?.toISOString() ?? null,
  };
}

function parseRole(value: unknown): Prisma.$Enums.erp_role | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase() as Prisma.$Enums.erp_role;
  return ROLE_VALUES.has(normalized) ? normalized : null;
}

export const handler = createHttpHandler<CreateUserBody>(async (request) => {
  const prisma = getPrisma();

  const auth = await requireUser(prisma, request.headers, { allowedRoles: ['admin'] });
  if ('statusCode' in auth) {
    return auth;
  }

  if (request.method === 'GET') {
    const users = await prisma.users.findMany({
      orderBy: { created_at: 'desc' },
      select: USER_SAFE_SELECT,
    });

    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ ok: true, users: users.map(serializeUser) }),
    };
  }

  if (request.method === 'POST') {
    const body = request.body ?? {};

    const email = normalizeEmail(body.email);
    const firstName = normalizeString(body.firstName);
    const lastName = normalizeString(body.lastName);
    const role = parseRole(body.role);
    const password = normalizeString(body.password);
    const active = typeof body.active === 'boolean' ? body.active : true;

    if (!email) {
      return errorResponse('INVALID_EMAIL', 'Debes indicar un correo electrónico válido.', 400);
    }

    if (!role) {
      return errorResponse('INVALID_ROLE', 'Debes seleccionar un rol válido.', 400);
    }

    if (!password || password.length < 6) {
      return errorResponse(
        'INVALID_PASSWORD',
        'La contraseña debe tener al menos 6 caracteres.',
        400,
      );
    }

    try {
      const hashed = await hashPassword(prisma, password);
      const user = await prisma.users.create({
        data: {
          first_name: firstName,
          last_name: lastName,
          email,
          role,
          active,
          password_hash: hashed,
          password_algo: 'bcrypt',
          password_updated_at: new Date(),
        },
        select: USER_SAFE_SELECT,
      });

      return {
        statusCode: 201,
        headers: COMMON_HEADERS,
        body: JSON.stringify({ ok: true, user: serializeUser(user) }),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return errorResponse('EMAIL_IN_USE', 'Ya existe un usuario con ese correo.', 409);
      }

      console.error('[users] Failed to create user', error);
      return errorResponse('CREATE_FAILED', 'No se pudo crear el usuario.', 500);
    }
  }

  return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
});
