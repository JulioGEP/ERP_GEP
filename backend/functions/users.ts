// backend/functions/users.ts
import { randomUUID } from 'crypto';
import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { requireRole } from './_lib/auth';

const ALLOWED_ROLES = [
  'admin',
  'comercial',
  'administracion',
  'logistica',
  'people',
  'formador',
] as const;

type AllowedRole = (typeof ALLOWED_ROLES)[number];

type UserRecord = {
  id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
  active: boolean;
};

type PrismaKnownError = {
  code: string;
  meta?: { target?: string | string[] };
};

function isPrismaKnownError(error: unknown): error is PrismaKnownError {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof (error as any).code === 'string',
  );
}

function handleKnownPrismaError(error: unknown) {
  if (isPrismaKnownError(error)) {
    if (error.code === 'P2002') {
      const target = Array.isArray(error.meta?.target)
        ? error.meta?.target.join(', ')
        : String(error.meta?.target ?? 'registro');
      return errorResponse('UNIQUE_CONSTRAINT', `Ya existe un usuario con ${target}`, 409);
    }
    if (error.code === '23505') {
      return errorResponse('UNIQUE_CONSTRAINT', 'Ya existe un usuario con estos datos', 409);
    }
  }
  return null;
}

function parseUserIdFromPath(path: string): string | null {
  const value = String(path || '');
  const match = value.match(/\/(?:\.netlify\/functions\/)?users\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function normalizeOptionalName(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function normalizeEmailInput(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text.length) return null;
  return text;
}

function normalizeRoleInput(value: unknown): AllowedRole | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return ALLOWED_ROLES.includes(normalized as AllowedRole)
    ? (normalized as AllowedRole)
    : null;
}

function normalizeActiveInput(value: unknown): boolean | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'sí', 'si', 'activo'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'inactivo'].includes(normalized)) return false;
    return null;
  }
  return null;
}

function buildDisplayName(firstName: string | null, lastName: string | null): string | null {
  const parts = [firstName ?? '', lastName ?? '']
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value && value.length));
  if (!parts.length) {
    return null;
  }
  return parts.join(' ');
}

function normalizeUser(record: UserRecord) {
  return {
    id: record.id,
    first_name: record.first_name ?? null,
    last_name: record.last_name ?? null,
    email: record.email,
    role: record.role,
    active: Boolean(record.active),
    name: record.name ?? buildDisplayName(record.first_name, record.last_name),
  };
}

function withSessionCookie<T extends { headers?: Record<string, string> }>(
  response: T,
  sessionCookie?: string,
): T {
  if (!sessionCookie) return response;
  return {
    ...response,
    headers: {
      ...(response.headers ?? {}),
      'Set-Cookie': sessionCookie,
    },
  };
}

export const handler = createHttpHandler<any>(async (request) => {
  const prisma = getPrisma();
  const auth = await requireRole(prisma, request, ['admin']);

  const method = request.method;
  const path = request.path || '';
  const userIdFromPath = parseUserIdFromPath(path);

  try {
    if (method === 'GET' && !userIdFromPath) {
      const rows = await prisma.$queryRaw<UserRecord[]>`
        SELECT id, first_name, last_name, name, email, role, active
        FROM users
        ORDER BY lower(last_name) NULLS FIRST, lower(first_name) NULLS FIRST, lower(email)
      `;

      const response = successResponse({ users: rows.map((row) => normalizeUser(row)) });
      return withSessionCookie(response, auth.sessionCookie);
    }

    if (method === 'POST') {
      if (!request.rawBody) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }

      const body = request.body && typeof request.body === 'object' ? (request.body as any) : {};

      const firstNameInput = normalizeOptionalName(body.first_name ?? body.firstName);
      const lastNameInput = normalizeOptionalName(body.last_name ?? body.lastName);
      const emailInput = normalizeEmailInput(body.email);
      const roleInput = normalizeRoleInput(body.role);

      if (!emailInput) {
        return errorResponse('VALIDATION_ERROR', 'El email es obligatorio', 400);
      }

      if (!roleInput) {
        return errorResponse('VALIDATION_ERROR', 'El rol es obligatorio', 400);
      }

      const userId = randomUUID();
      const firstName = firstNameInput ?? null;
      const lastName = lastNameInput ?? null;
      const displayName = buildDisplayName(firstName, lastName);

      const createdUsers = await prisma.$queryRaw<UserRecord[]>`
        INSERT INTO users (id, first_name, last_name, name, email, role, active)
        VALUES (${userId}::uuid, ${firstName}, ${lastName}, ${displayName}, ${emailInput}, ${roleInput}, true)
        RETURNING id, first_name, last_name, name, email, role, active
      `;

      if (!createdUsers.length) {
        return errorResponse('UNEXPECTED_ERROR', 'No se pudo crear el usuario', 500);
      }

      const response = successResponse({ user: normalizeUser(createdUsers[0]) }, 201);
      return withSessionCookie(response, auth.sessionCookie);
    }

    if (method === 'PATCH' && userIdFromPath) {
      if (!request.rawBody) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }

      const existingUsers = await prisma.$queryRaw<UserRecord[]>`
        SELECT id, first_name, last_name, name, email, role, active
        FROM users
        WHERE id = ${userIdFromPath}::uuid
        LIMIT 1
      `;

      if (!existingUsers.length) {
        return errorResponse('NOT_FOUND', 'Usuario no encontrado', 404);
      }

      const existing = existingUsers[0];
      const body = request.body && typeof request.body === 'object' ? (request.body as any) : {};

      const firstNameInput = normalizeOptionalName(body.first_name ?? body.firstName);
      const lastNameInput = normalizeOptionalName(body.last_name ?? body.lastName);
      const emailInput = normalizeEmailInput(body.email);
      const roleInput = normalizeRoleInput(body.role);
      const activeInput = normalizeActiveInput(body.active);

      if (emailInput === null) {
        return errorResponse('VALIDATION_ERROR', 'El email es obligatorio', 400);
      }

      if (roleInput === null) {
        return errorResponse('VALIDATION_ERROR', 'Rol inválido', 400);
      }

      if (activeInput === null) {
        return errorResponse('VALIDATION_ERROR', 'Valor de activo inválido', 400);
      }

      const nextFirstName = firstNameInput !== undefined ? firstNameInput : existing.first_name;
      const nextLastName = lastNameInput !== undefined ? lastNameInput : existing.last_name;
      const nextEmail = emailInput !== undefined ? emailInput : existing.email;
      const nextRole = roleInput !== undefined ? roleInput : (existing.role as AllowedRole);
      const nextActive = activeInput !== undefined ? activeInput : Boolean(existing.active);
      const nextDisplayName = buildDisplayName(nextFirstName, nextLastName);

      const hasChanges =
        nextFirstName !== existing.first_name ||
        nextLastName !== existing.last_name ||
        nextEmail !== existing.email ||
        nextRole !== existing.role ||
        nextActive !== existing.active ||
        nextDisplayName !== (existing.name ?? buildDisplayName(existing.first_name, existing.last_name));

      if (!hasChanges) {
        return errorResponse('VALIDATION_ERROR', 'No se han proporcionado cambios', 400);
      }

      const updatedUsers = await prisma.$queryRaw<UserRecord[]>`
        UPDATE users
        SET first_name = ${nextFirstName},
            last_name = ${nextLastName},
            name = ${nextDisplayName},
            email = ${nextEmail},
            role = ${nextRole},
            active = ${nextActive}
        WHERE id = ${userIdFromPath}::uuid
        RETURNING id, first_name, last_name, name, email, role, active
      `;

      if (!updatedUsers.length) {
        return errorResponse('UNEXPECTED_ERROR', 'No se pudo actualizar el usuario', 500);
      }

      const response = successResponse({ user: normalizeUser(updatedUsers[0]) });
      return withSessionCookie(response, auth.sessionCookie);
    }

    return errorResponse('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (error) {
    const handled = handleKnownPrismaError(error);
    if (handled) return handled;

    console.error('[users] Unexpected error', error);
    return errorResponse('UNEXPECTED_ERROR', 'Error inesperado', 500);
  }
});
