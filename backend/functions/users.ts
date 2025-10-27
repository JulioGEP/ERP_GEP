import { Prisma } from '@prisma/client';

import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { requireRole, serializeUser } from './_shared/auth';
import { isValidUserRole, USER_ROLES } from './_shared/permissions';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

type UserCreateBody = {
  first_name?: unknown;
  last_name?: unknown;
  email?: unknown;
  role?: unknown;
};

type UserUpdateBody = {
  first_name?: unknown;
  last_name?: unknown;
  role?: unknown;
  active?: unknown;
};

function parsePage(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

function parsePageSize(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(parsed), MAX_PAGE_SIZE);
}

function parseActiveFilter(value: unknown): boolean | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'activo', 'activos'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'inactive', 'inactivo', 'inactivos'].includes(normalized)) return false;
  return null;
}

function normalizeSearchQuery(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function normalizeName(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (value === null) {
    throw errorResponse('VALIDATION_ERROR', `El campo ${field} es obligatorio.`, 400);
  }
  const text = String(value).trim();
  if (!text.length) {
    throw errorResponse('VALIDATION_ERROR', `El campo ${field} es obligatorio.`, 400);
  }
  return text;
}

function normalizeRole(value: unknown) {
  if (value === undefined) return undefined;
  const role = String(value).trim().toLowerCase();
  if (!isValidUserRole(role)) {
    throw errorResponse(
      'INVALID_ROLE',
      `El rol debe ser uno de: ${USER_ROLES.join(', ')}.`,
      400,
    );
  }
  return role;
}

function normalizeEmail(value: unknown) {
  const text = normalizeName(value, 'email');
  const emailRegex = /^(?:[^\s@]+)@(?:[^\s@]+)\.[^\s@]+$/;
  if (!emailRegex.test(text)) {
    throw errorResponse('INVALID_EMAIL', 'El email no tiene un formato válido.', 400);
  }
  return text.toLowerCase();
}

function parseUserIdFromPath(path: string): string | null {
  const match = path.match(/\/(?:\.netlify\/functions\/)?users\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function normalizeActive(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'activo'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'inactivo'].includes(normalized)) return false;
  throw errorResponse('INVALID_ACTIVE', 'El campo active debe ser booleano.', 400);
}

export default createHttpHandler(async (request) => {
  const prisma = getPrisma();

  if (request.method === 'GET') {
    const auth = await requireRole(request, ['admin']);
    if ('error' in auth) {
      return auth.error;
    }

    const page = parsePage(request.query.page);
    const pageSize = parsePageSize(request.query.per_page ?? request.query.page_size);
    const activeFilter = parseActiveFilter(request.query.active);
    const searchQuery = normalizeSearchQuery(request.query.q);

    let roleFilter: string | undefined;
    try {
      roleFilter = normalizeRole(request.query.role);
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) {
        return error as ReturnType<typeof errorResponse>;
      }
      return errorResponse('VALIDATION_ERROR', 'Rol inválido.', 400);
    }

    const where: Prisma.usersWhereInput = {};
    if (activeFilter !== null) {
      where.active = activeFilter;
    }
    if (roleFilter) {
      where.role = roleFilter as any;
    }
    if (searchQuery) {
      where.OR = [
        { first_name: { contains: searchQuery, mode: 'insensitive' } },
        { last_name: { contains: searchQuery, mode: 'insensitive' } },
        { email: { contains: searchQuery, mode: 'insensitive' } },
      ];
    }

    const skip = (page - 1) * pageSize;

    const [total, records] = await Promise.all([
      prisma.users.count({ where }),
      prisma.users.findMany({
        where,
        orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
        skip,
        take: pageSize,
      }),
    ]);

    const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;

    return successResponse({
      data: records.map(serializeUser),
      meta: {
        page,
        per_page: pageSize,
        total,
        total_pages: totalPages,
      },
    });
  }

  if (request.method === 'POST') {
    const auth = await requireRole(request, ['admin']);
    if ('error' in auth) {
      return auth.error;
    }

    const body = (request.body ?? {}) as UserCreateBody;

    let firstName: string;
    let lastName: string;
    let email: string;
    let role: string;

    try {
      firstName = normalizeName(body.first_name, 'first_name');
      lastName = normalizeName(body.last_name, 'last_name');
      email = normalizeEmail(body.email);
      const normalizedRole = normalizeRole(body.role);
      if (!normalizedRole) {
        throw errorResponse('INVALID_ROLE', 'El rol es obligatorio.', 400);
      }
      role = normalizedRole;
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) {
        return error as ReturnType<typeof errorResponse>;
      }
      return errorResponse('VALIDATION_ERROR', 'Datos inválidos.', 400);
    }

    const existing = await prisma.users.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });

    if (existing) {
      return errorResponse('EMAIL_IN_USE', 'Ya existe un usuario con ese email.', 409);
    }

    try {
      const created = await prisma.users.create({
        data: {
          first_name: firstName,
          last_name: lastName,
          email,
          role: role as any,
          active: true,
        },
      });

      return successResponse({ data: serializeUser(created) }, 201);
    } catch (error) {
      console.error('[users] Error al crear usuario', error);
      return errorResponse('CREATE_FAILED', 'No se pudo crear el usuario.', 500);
    }
  }

  if (request.method === 'PATCH') {
    const auth = await requireRole(request, ['admin']);
    if ('error' in auth) {
      return auth.error;
    }

    const userId = parseUserIdFromPath(request.path || '');
    if (!userId) {
      return errorResponse('INVALID_ID', 'Identificador de usuario inválido.', 400);
    }

    const body = (request.body ?? {}) as UserUpdateBody;

    const data: Prisma.usersUpdateInput = {};
    try {
      if ('first_name' in body) {
        data.first_name = normalizeName(body.first_name, 'first_name');
      }
      if ('last_name' in body) {
        data.last_name = normalizeName(body.last_name, 'last_name');
      }
      if ('role' in body) {
        const normalizedRole = normalizeRole(body.role);
        if (!normalizedRole) {
          throw errorResponse('INVALID_ROLE', 'El rol es obligatorio.', 400);
        }
        data.role = normalizedRole as any;
      }
      if ('active' in body) {
        data.active = normalizeActive(body.active);
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) {
        return error as ReturnType<typeof errorResponse>;
      }
      return errorResponse('VALIDATION_ERROR', 'Datos inválidos.', 400);
    }

    if (Object.keys(data).length === 0) {
      return errorResponse('NO_CHANGES', 'No se proporcionaron campos para actualizar.', 400);
    }

    try {
      const updated = await prisma.users.update({
        where: { id: userId },
        data,
      });
      return successResponse({ data: serializeUser(updated) });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return errorResponse('USER_NOT_FOUND', 'El usuario no existe.', 404);
      }
      console.error('[users] Error al actualizar usuario', error);
      return errorResponse('UPDATE_FAILED', 'No se pudo actualizar el usuario.', 500);
    }
  }

  return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido.', 405);
});
