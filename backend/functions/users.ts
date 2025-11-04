// backend/functions/users.ts
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import type { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import { updateTrainerFromUser } from './_shared/trainer-user-sync';
import {
  getRoleDisplayValue,
  getRoleStorageValue,
  normalizeEmail,
  requireAuth,
} from './_shared/auth';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const DEFAULT_PASSWORD = '123456';
const BCRYPT_SALT_ROUNDS = 10;

function serializeUser(user: any) {
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    role: getRoleDisplayValue(user.role) ?? user.role,
    active: user.active,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

function sanitizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function parseUserId(path: string): string | null {
  const match = path.match(/\/users\/([^/?#]+)/i);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function parsePageParam(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  if (normalized <= 0) return fallback;
  return Math.min(normalized, max);
}

export const handler = createHttpHandler<any>(async (request) => {
  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ['Admin'] });

  if ('error' in auth) {
    return auth.error;
  }

  switch (request.method) {
    case 'GET':
      return handleList(request, prisma);
    case 'POST':
      return handleCreate(request, prisma);
    case 'PATCH':
      return handleUpdate(request, prisma);
    default:
      return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }
});

async function handleList(request: any, prisma: ReturnType<typeof getPrisma>) {
  const page = parsePageParam(request.query.page, 1, 1_000_000);
  const pageSize = parsePageParam(request.query.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const search = typeof request.query.search === 'string' ? request.query.search.trim() : '';

  const where = search
    ? {
        OR: [
          { first_name: { contains: search, mode: 'insensitive' } },
          { last_name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }
    : undefined;

  const [total, users] = await Promise.all([
    prisma.users.count({ where: where as any }),
    prisma.users.findMany({
      orderBy: [{ last_name: 'asc' }, { first_name: 'asc' }, { email: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return successResponse({
    users: users.map(serializeUser),
    total,
    page,
    pageSize,
  });
}

async function handleCreate(request: any, prisma: ReturnType<typeof getPrisma>) {
  const firstName = sanitizeName(request.body?.firstName);
  const lastName = sanitizeName(request.body?.lastName);
  const email = normalizeEmail(request.body?.email);
  const roleInput = typeof request.body?.role === 'string' ? request.body.role.trim() : '';
  const active = request.body?.active === undefined ? true : Boolean(request.body.active);

  if (!firstName || !lastName || !email || !roleInput.length) {
    return errorResponse('INVALID_INPUT', 'Todos los campos son obligatorios', 400);
  }

  const roleStorage = getRoleStorageValue(roleInput);
  if (!roleStorage) {
    return errorResponse('INVALID_ROLE', 'Rol inválido', 400);
  }

  try {
    const now = new Date();
    const existingUsers = await prisma.users.findMany({
      where: { email: { equals: email, mode: 'insensitive' } },
      orderBy: { created_at: 'asc' },
    });

    let passwordHash: string | null = null;
    let passwordAlgo = 'bcrypt';
    let passwordUpdatedAt = now;

    for (const candidate of existingUsers) {
      if (candidate.password_hash) {
        passwordHash = candidate.password_hash;
        passwordAlgo = candidate.password_algo ?? 'bcrypt';
        passwordUpdatedAt = candidate.password_updated_at ?? now;
        break;
      }
    }

    if (!passwordHash) {
      passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_SALT_ROUNDS);
      passwordAlgo = 'bcrypt';
      passwordUpdatedAt = now;
    }

    const user = await prisma.users.create({
      data: {
        first_name: firstName,
        last_name: lastName,
        email,
        role: roleStorage,
        active,
        password_hash: passwordHash,
        password_algo: passwordAlgo,
        password_updated_at: passwordUpdatedAt,
      },
    });

    return successResponse({ user: serializeUser(user) }, 201);
  } catch (error) {
    if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
      return errorResponse('EMAIL_EXISTS', 'El email ya está registrado', 409);
    }
    console.error('[users] Error creating user', error as Error);
    return errorResponse('CREATE_FAILED', 'No se pudo crear el usuario', 500);
  }
}

async function handleUpdate(request: any, prisma: ReturnType<typeof getPrisma>) {
  const userId = parseUserId(request.path);
  if (!userId) {
    return errorResponse('INVALID_ID', 'Identificador inválido', 400);
  }

  type UserUpdateData = {
    first_name?: string;
    last_name?: string;
    email?: string;
    role?: string;
    active?: boolean;
  };

  const data: UserUpdateData = {};
  let activeProvided = false;

  const existingUser = await prisma.users.findUnique({ where: { id: userId } });
  if (!existingUser) {
    return errorResponse('NOT_FOUND', 'Usuario no encontrado', 404);
  }

  if ('firstName' in (request.body ?? {})) {
    const firstName = sanitizeName(request.body?.firstName);
    if (!firstName) {
      return errorResponse('INVALID_INPUT', 'Nombre inválido', 400);
    }
    data.first_name = firstName;
  }

  if ('lastName' in (request.body ?? {})) {
    const lastName = sanitizeName(request.body?.lastName);
    if (!lastName) {
      return errorResponse('INVALID_INPUT', 'Apellido inválido', 400);
    }
    data.last_name = lastName;
  }

  if ('email' in (request.body ?? {})) {
    const email = normalizeEmail(request.body?.email);
    if (!email) {
      return errorResponse('INVALID_INPUT', 'Email inválido', 400);
    }
    data.email = email;
  }

  if ('role' in (request.body ?? {})) {
    const roleInput = typeof request.body?.role === 'string' ? request.body.role.trim() : '';
    const roleStorage = getRoleStorageValue(roleInput);
    if (!roleStorage) {
      return errorResponse('INVALID_ROLE', 'Rol inválido', 400);
    }
    if (existingUser.trainer_id && roleStorage !== 'formador') {
      return errorResponse('INVALID_ROLE', 'Los formadores solo pueden tener rol Formador', 400);
    }
    data.role = roleStorage;
  }

  if ('active' in (request.body ?? {})) {
    data.active = Boolean(request.body?.active);
    activeProvided = true;
  }

  if (Object.keys(data).length === 0) {
    return errorResponse('NO_UPDATES', 'No se enviaron cambios', 400);
  }

  const now = new Date();

  try {
    const user = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.users.update({
        where: { id: userId },
        data,
      });

      if (updated.trainer_id) {
        await updateTrainerFromUser(tx, updated, {
          first_name: updated.first_name,
          last_name: updated.last_name,
          email: updated.email,
          active: updated.active,
        });
      }

      if (activeProvided && data.active === false && existingUser.active) {
        await tx.auth_sessions.updateMany({
          where: { user_id: userId, revoked_at: null },
          data: { revoked_at: now },
        });
      }

      return updated;
    });

    return successResponse({ user: serializeUser(user) });
  } catch (error) {
    if (error instanceof PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return errorResponse('EMAIL_EXISTS', 'El email ya está registrado', 409);
      }
      if (error.code === 'P2025') {
        return errorResponse('NOT_FOUND', 'Usuario no encontrado', 404);
      }
    }
    console.error('[users] Error updating user', error as Error);
    return errorResponse('UPDATE_FAILED', 'No se pudo actualizar el usuario', 500);
  }
}
