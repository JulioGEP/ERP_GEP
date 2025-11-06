// backend/functions/users.ts
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import type { $Enums } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
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
    firstName: user.first_name ?? '',
    lastName: user.last_name ?? '',
    email: user.email ?? '',
    role: getRoleDisplayValue(user.role) ?? user.role ?? '',
    active: Boolean(user.active),
    createdAt: user.created_at ?? null,
    updatedAt: user.updated_at ?? null,
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

/**
 * Sincroniza el usuario (rol formador) con su espejo en trainers.
 * Estrategia:
 * 1) Busca trainer por user_id.
 * 2) Si no existe, busca por email (único).
 * 3) Actualiza el encontrado; si no existe y role === 'formador', crea uno nuevo.
 * 4) Asegura el enlace trainers.user_id = users.id.
 */
async function syncTrainerForFormador(
  tx: ReturnType<typeof getPrisma>,
  user: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    role: $Enums.erp_role;
    active: boolean;
  }
) {
  if (user.role !== 'formador') return; // sólo sincronizamos para formadores
  if (!user.email) return; // necesitamos email para la duplicidad funcional

  // 1) por user_id
  let trainer = await tx.trainers.findUnique({
    where: { user_id: user.id },
  });

  // 2) si no, por email
  if (!trainer) {
    trainer = await tx.trainers.findUnique({
      where: { email: user.email },
    });
  }

  const trainerData = {
    name: user.first_name,
    apellido: user.last_name ?? null,
    email: user.email,
    activo: user.active,
    user_id: user.id,
  };

  if (trainer) {
    await tx.trainers.update({
      where: { trainer_id: trainer.trainer_id },
      data: trainerData,
    });
  } else {
    await tx.trainers.create({
      data: {
        trainer_id: randomUUID(),
        ...trainerData,
        // valores neutros para campos opcionales
        phone: null,
        dni: null,
        direccion: null,
        especialidad: null,
        titulacion: null,
        sede: [],
      },
    });
  }
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

  try {
    const [total, users] = await Promise.all([
      prisma.users.count({ where: where as any }),
      prisma.users.findMany({
        where: where as any,
        orderBy: [{ last_name: 'asc' }, { first_name: 'asc' }, { email: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          first_name: true,
          last_name: true,
          email: true,
          role: true,
          active: true,
          created_at: true,
          updated_at: true,
        },
      }),
    ]);

    return successResponse({
      users: users.map(serializeUser),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('[users] Error listing users', error);
    return errorResponse('LIST_FAILED', 'No se pudieron cargar los usuarios', 500);
  }
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
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_SALT_ROUNDS);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.users.create({
        data: {
          first_name: firstName,
          last_name: lastName,
          email,
          role: roleStorage as $Enums.erp_role,
          active,
          password_hash: passwordHash,
          password_algo: 'bcrypt',
          password_updated_at: now,
        },
      });

      // Sincroniza trainer si corresponde
      await syncTrainerForFormador(tx as any, {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role,
        active: user.active,
      });

      return user;
    });

    return successResponse({ user: serializeUser(result) }, 201);
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
    role?: $Enums.erp_role;
    active?: boolean;
  };

  const data: UserUpdateData = {};
  let activeProvided = false;

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
    data.role = roleStorage as $Enums.erp_role;
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
    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.users.update({
        where: { id: userId },
        data,
      });

      if (activeProvided && data.active === false) {
        await tx.auth_sessions.updateMany({
          where: { user_id: userId, revoked_at: null },
          data: { revoked_at: now },
        });
      }

      // Sincroniza trainer si corresponde (rol formador)
      await syncTrainerForFormador(tx as any, {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role,
        active: user.active,
      });

      return user;
    });

    return successResponse({ user: serializeUser(updated) });
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
