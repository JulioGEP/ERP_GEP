// backend/functions/users.ts
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { Prisma, $Enums } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { getPrisma } from './_shared/prisma';
import {
  type AuthenticatedContext,
  getRoleDisplayValue,
  getRoleStorageValue,
  normalizeEmail,
  normalizeRoleKey,
  requireAuth,
} from './_shared/auth';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const DEFAULT_PASSWORD = '123456';
const BCRYPT_SALT_ROUNDS = 10;
const DEFAULT_WEEKLY_HOURS = 40;

type SerializedPayroll = {
  convenio: string;
  categoria: string;
  antiguedad: string | null;
  horasSemana: number;
  baseRetencion: number | null;
  salarioBruto: number | null;
  salarioBrutoTotal: number | null;
  retencion: number | null;
  aportacionSsIrpf: number | null;
  aportacionSsIrpfDetalle: string | null;
  salarioLimpio: number | null;
  contingenciasComunes: number | null;
  contingenciasComunesDetalle: string | null;
  totalEmpresa: number | null;
};

function serializePayroll(payroll: any | null | undefined): SerializedPayroll {
  return {
    convenio: payroll?.convenio ?? '',
    categoria: payroll?.categoria ?? '',
    antiguedad: payroll?.antiguedad ? payroll.antiguedad.toISOString().slice(0, 10) : null,
    horasSemana:
      payroll?.horas_semana === undefined || payroll?.horas_semana === null
        ? DEFAULT_WEEKLY_HOURS
        : Number(payroll.horas_semana),
    baseRetencion:
      payroll?.base_retencion === undefined || payroll?.base_retencion === null
        ? null
        : Number(payroll.base_retencion),
    salarioBruto:
      payroll?.salario_bruto === undefined || payroll?.salario_bruto === null
        ? null
        : Number(payroll.salario_bruto),
    salarioBrutoTotal:
      payroll?.salario_bruto_total === undefined || payroll?.salario_bruto_total === null
        ? null
        : Number(payroll.salario_bruto_total),
    retencion:
      payroll?.retencion === undefined || payroll?.retencion === null ? null : Number(payroll.retencion),
    aportacionSsIrpf:
      payroll?.aportacion_ss_irpf === undefined || payroll?.aportacion_ss_irpf === null
        ? null
        : Number(payroll.aportacion_ss_irpf),
    aportacionSsIrpfDetalle: payroll?.aportacion_ss_irpf_detalle ?? null,
    salarioLimpio:
      payroll?.salario_limpio === undefined || payroll?.salario_limpio === null
        ? null
        : Number(payroll.salario_limpio),
    contingenciasComunes:
      payroll?.contingencias_comunes === undefined || payroll?.contingencias_comunes === null
        ? null
        : Number(payroll.contingencias_comunes),
    contingenciasComunesDetalle: payroll?.contingencias_comunes_detalle ?? null,
    totalEmpresa:
      payroll?.total_empresa === undefined || payroll?.total_empresa === null
        ? null
        : Number(payroll.total_empresa),
  };
}

function serializeUser(user: any) {
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    role: getRoleDisplayValue(user.role) ?? user.role,
    active: user.active,
    bankAccount: user.bank_account,
    address: user.address,
    position: user.position,
    startDate: user.start_date,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    trainerId: user.trainer?.trainer_id ?? null,
    trainerFixedContract: user.trainer?.contrato_fijo ?? null,
    payroll: serializePayroll(user.payroll),
  };
}

function sanitizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function sanitizeText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function parseBankAccount(value: unknown): { parsed: string | null; valid: boolean } {
  if (value === undefined || value === null) {
    return { parsed: null, valid: true };
  }

  const text = String(value).trim();
  if (!text.length) {
    return { parsed: null, valid: true };
  }

  const normalized = text.replace(/[\s-]+/g, '').toUpperCase();
  if (!/^[A-Z0-9]+$/.test(normalized)) {
    return { parsed: null, valid: false };
  }

  return { parsed: normalized, valid: true };
}

function parseDateOnly(value: unknown): Date | null {
  if (!value) return null;
  const input = typeof value === 'string' ? value.trim() : String(value);
  if (!input.length) return null;
  const normalized = input.includes('T') ? input.split('T')[0] : input;
  const result = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(result.getTime())) return null;
  return result;
}

function parseDecimalField(
  value: unknown,
  { allowNull = true, scale = 2 }: { allowNull?: boolean; scale?: number } = {},
): { provided: boolean; value?: Prisma.Decimal | null; error?: string } {
  if (value === undefined) return { provided: false };
  if (value === null || value === '') {
    return allowNull ? { provided: true, value: null } : { provided: true, value: new Prisma.Decimal(0) };
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return { provided: true, error: 'INVALID_NUMBER' };
  }

  const normalized = numeric.toFixed(scale);
  return { provided: true, value: new Prisma.Decimal(normalized) };
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

function parseBooleanParam(value: unknown, fallback: boolean): boolean {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized.length) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

/**
 * Sincroniza el usuario (rol formador) con su espejo en trainers.
 * 1) Busca trainer por user_id.
 * 2) Si no existe, busca por email.
 * 3) Actualiza el encontrado o crea uno nuevo.
 * 4) Enlaza siempre trainers.user_id = users.id.
 */
async function syncTrainerForFormador(
  tx: Prisma.TransactionClient,
  user: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    role: string;
    active: boolean;
  },
) {
  if (normalizeRoleKey(user.role) !== 'formador') return;
  if (!user.email) return;

  // 1) por user_id
  let trainer = await tx.trainers.findUnique({
    where: { user_id: user.id },
  });

  // 2) si no, por email (único)
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
  const auth = await requireAuth(request, prisma);

  if ('error' in auth) {
    return auth.error;
  }

  switch (request.method) {
    case 'GET':
      return handleGet(request, prisma, auth);
    case 'POST':
      return handleCreate(request, prisma, auth);
    case 'PATCH':
      return handleUpdate(request, prisma, auth);
    default:
      return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }
});

function isAdmin(auth: AuthenticatedContext): boolean {
  return normalizeRoleKey(auth.user.role) === 'admin';
}

async function handleGet(
  request: any,
  prisma: ReturnType<typeof getPrisma>,
  auth: AuthenticatedContext,
) {
  const userId = parseUserId(request.path);

  if (userId) {
    if (!isAdmin(auth) && auth.user.id !== userId) {
      return errorResponse('FORBIDDEN', 'No tienes permisos para esta operación', 403);
    }

    const user = await prisma.users.findUnique({
      where: { id: userId },
      include: { trainer: true, payroll: true },
    });

    if (!user) {
      return errorResponse('NOT_FOUND', 'Usuario no encontrado', 404);
    }

    return successResponse({ user: serializeUser(user) });
  }

  if (!isAdmin(auth)) {
    return errorResponse('FORBIDDEN', 'No tienes permisos para esta operación', 403);
  }

  return handleList(request, prisma);
}

async function handleList(request: any, prisma: ReturnType<typeof getPrisma>) {
  try {
    const page = parsePageParam(request.query?.page, 1, 1_000_000);
    const pageSize = parsePageParam(
      request.query?.pageSize,
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );
    const search =
      typeof request.query?.search === 'string' ? request.query.search.trim() : '';

    const statusInput =
      typeof request.query?.status === 'string' ? request.query.status.trim().toLowerCase() : '';
    const statusFilter = statusInput === 'active' || statusInput === 'inactive' ? statusInput : null;
    const trainerFixedOnly = parseBooleanParam(request.query?.trainerFixedOnly, false);
    const includeTrainers =
      parseBooleanParam(request.query?.includeTrainers, false) || trainerFixedOnly;

    const whereFilters: Array<Record<string, any>> = [];

    if (search.length) {
      whereFilters.push({
        OR: [
          { first_name: { contains: search, mode: 'insensitive' } },
          { last_name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    if (statusFilter === 'active') {
      whereFilters.push({ active: true });
    } else if (statusFilter === 'inactive') {
      whereFilters.push({ active: false });
    }

    if (!includeTrainers) {
      const formadorRole = getRoleStorageValue('Formador');
      if (formadorRole) {
        whereFilters.push({ NOT: { role: formadorRole } });
      }
    }

    if (trainerFixedOnly) {
      whereFilters.push({ trainer: { is: { contrato_fijo: true } } });
    }

    const where = whereFilters.length > 0 ? { AND: whereFilters } : undefined;

    const [total, users] = await Promise.all([
      prisma.users.count({ where: where as any }),
      prisma.users.findMany({
        orderBy: [{ last_name: 'asc' }, { first_name: 'asc' }, { email: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        where: where as any,
        include: { trainer: true, payroll: true },
      }),
    ]);

    return successResponse({
      users: users.map(serializeUser),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    // Esto evita el 500 "ciego" y te devuelve un mensaje concreto
    console.error('[users] Error listing users', error);
    return errorResponse(
      'LIST_FAILED',
      'No se pudieron listar los usuarios (revisa logs de Netlify para el detalle exacto).',
      500,
    );
  }
}

async function handleCreate(
  request: any,
  prisma: ReturnType<typeof getPrisma>,
  auth: AuthenticatedContext,
) {
  if (!isAdmin(auth)) {
    return errorResponse('FORBIDDEN', 'No tienes permisos para esta operación', 403);
  }

  const firstName = sanitizeName(request.body?.firstName);
  const lastName = sanitizeName(request.body?.lastName);
  const email = normalizeEmail(request.body?.email);
  const roleInput = typeof request.body?.role === 'string' ? request.body.role.trim() : '';
  const active = request.body?.active === undefined ? true : Boolean(request.body.active);
  const bankAccountResult = parseBankAccount(request.body?.bankAccount);
  const address = sanitizeText(request.body?.address);
  const position = sanitizeText(request.body?.position);
  const startDate = parseDateOnly(request.body?.startDate);

  if (request.body?.startDate && !startDate) {
    return errorResponse('INVALID_INPUT', 'Fecha de alta inválida', 400);
  }

  if (!bankAccountResult.valid) {
    return errorResponse('INVALID_INPUT', 'Cuenta bancaria inválida', 400);
  }

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

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const user = await tx.users.create({
        data: {
          first_name: firstName,
          last_name: lastName,
          email,
          role: roleStorage as $Enums.erp_role,
          active,
          bank_account: bankAccountResult.parsed,
          address,
          position,
          start_date: startDate ?? undefined,
          password_hash: passwordHash,
          password_algo: 'bcrypt',
          password_updated_at: now,
        },
      });

      await syncTrainerForFormador(tx, {
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

async function handleUpdate(
  request: any,
  prisma: ReturnType<typeof getPrisma>,
  auth: AuthenticatedContext,
) {
  if (!isAdmin(auth)) {
    return errorResponse('FORBIDDEN', 'No tienes permisos para esta operación', 403);
  }

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
    bank_account?: string | null;
    address?: string | null;
    position?: string | null;
    start_date?: Date | null;
  };

  const data: UserUpdateData = {};
  let activeProvided = false;
  let fieldsProvided = 0;
  const payrollInput = (request.body ?? {}).payroll ?? {};
  const payrollUpdate: Prisma.user_payrollsUpdateInput = {};
  let payrollFieldsProvided = 0;

  if ('firstName' in (request.body ?? {})) {
    const firstName = sanitizeName(request.body?.firstName);
    if (!firstName) {
      return errorResponse('INVALID_INPUT', 'Nombre inválido', 400);
    }
    data.first_name = firstName;
    fieldsProvided += 1;
  }

  if ('lastName' in (request.body ?? {})) {
    const lastName = sanitizeName(request.body?.lastName);
    if (!lastName) {
      return errorResponse('INVALID_INPUT', 'Apellido inválido', 400);
    }
    data.last_name = lastName;
    fieldsProvided += 1;
  }

  if ('email' in (request.body ?? {})) {
    const email = normalizeEmail(request.body?.email);
    if (!email) {
      return errorResponse('INVALID_INPUT', 'Email inválido', 400);
    }
    data.email = email;
    fieldsProvided += 1;
  }

  if ('role' in (request.body ?? {})) {
    const roleInput = typeof request.body?.role === 'string' ? request.body.role.trim() : '';
    const roleStorage = getRoleStorageValue(roleInput);
    if (!roleStorage) {
      return errorResponse('INVALID_ROLE', 'Rol inválido', 400);
    }
    data.role = roleStorage as $Enums.erp_role;
    fieldsProvided += 1;
  }

  if ('active' in (request.body ?? {})) {
    data.active = Boolean(request.body?.active);
    activeProvided = true;
    fieldsProvided += 1;
  }

  if ('bankAccount' in (request.body ?? {})) {
    const bankAccountResult = parseBankAccount(request.body?.bankAccount);
    if (!bankAccountResult.valid) {
      return errorResponse('INVALID_INPUT', 'Cuenta bancaria inválida', 400);
    }
    data.bank_account = bankAccountResult.parsed;
    fieldsProvided += 1;
  }

  if ('address' in (request.body ?? {})) {
    const address = sanitizeText(request.body?.address);
    data.address = address;
    fieldsProvided += 1;
  }

  if ('position' in (request.body ?? {})) {
    const position = sanitizeText(request.body?.position);
    data.position = position;
    fieldsProvided += 1;
  }

  if ('startDate' in (request.body ?? {})) {
    const startDate = parseDateOnly(request.body?.startDate);
    if (request.body?.startDate && !startDate) {
      return errorResponse('INVALID_INPUT', 'Fecha de alta inválida', 400);
    }
    data.start_date = startDate;
    fieldsProvided += 1;
  }

  if ('convenio' in payrollInput) {
    payrollUpdate.convenio = sanitizeText(payrollInput.convenio);
    payrollFieldsProvided += 1;
  }

  if ('categoria' in payrollInput) {
    payrollUpdate.categoria = sanitizeText(payrollInput.categoria);
    payrollFieldsProvided += 1;
  }

  if ('antiguedad' in payrollInput) {
    const antiguedad = parseDateOnly(payrollInput.antiguedad);
    if (payrollInput.antiguedad && !antiguedad) {
      return errorResponse('INVALID_INPUT', 'Fecha de antigüedad inválida', 400);
    }
    payrollUpdate.antiguedad = antiguedad;
    payrollFieldsProvided += 1;
  }

  if ('aportacionSsIrpfDetalle' in payrollInput) {
    payrollUpdate.aportacion_ss_irpf_detalle = sanitizeText(payrollInput.aportacionSsIrpfDetalle);
    payrollFieldsProvided += 1;
  }

  if ('contingenciasComunesDetalle' in payrollInput) {
    payrollUpdate.contingencias_comunes_detalle = sanitizeText(payrollInput.contingenciasComunesDetalle);
    payrollFieldsProvided += 1;
  }

  const decimalFields: Array<{
    key: keyof Prisma.user_payrollsUpdateInput;
    inputKey: string;
    label: string;
    scale?: number;
  }> = [
    { key: 'horas_semana', inputKey: 'horasSemana', label: 'Horas semana', scale: 2 },
    { key: 'base_retencion', inputKey: 'baseRetencion', label: 'Base de retención' },
    { key: 'salario_bruto', inputKey: 'salarioBruto', label: 'Salario bruto' },
    { key: 'salario_bruto_total', inputKey: 'salarioBrutoTotal', label: 'Salario bruto total' },
    { key: 'retencion', inputKey: 'retencion', label: 'Retención' },
    { key: 'aportacion_ss_irpf', inputKey: 'aportacionSsIrpf', label: 'Aportación SS e IRPF' },
    { key: 'salario_limpio', inputKey: 'salarioLimpio', label: 'Salario limpio' },
    { key: 'contingencias_comunes', inputKey: 'contingenciasComunes', label: 'Contingencias comunes' },
    { key: 'total_empresa', inputKey: 'totalEmpresa', label: 'Total empresa' },
  ];

  for (const field of decimalFields) {
    if (field.inputKey in payrollInput) {
      const parsed = parseDecimalField(payrollInput[field.inputKey], { scale: field.scale ?? 2 });
      if (parsed.error) {
        return errorResponse('INVALID_INPUT', `${field.label} inválido`, 400);
      }
      payrollUpdate[field.key] = parsed.value as Prisma.Decimal | null | undefined;
      payrollFieldsProvided += 1;
    }
  }

  if (fieldsProvided === 0 && payrollFieldsProvided === 0) {
    return errorResponse('NO_UPDATES', 'No se enviaron cambios', 400);
  }

  const now = new Date();

  try {
    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existingUser = await tx.users.findUnique({ where: { id: userId }, include: { trainer: true } });
      if (!existingUser) {
        throw new Error('USER_NOT_FOUND');
      }

      const user =
        fieldsProvided > 0
          ? await tx.users.update({
              where: { id: userId },
              data,
            })
          : existingUser;

      if (activeProvided && data.active === false) {
        await tx.auth_sessions.updateMany({
          where: { user_id: userId, revoked_at: null },
          data: { revoked_at: now },
        });
      }

      await syncTrainerForFormador(tx, {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role,
        active: user.active,
      });

      if (payrollFieldsProvided > 0) {
        await tx.user_payrolls.upsert({
          where: { user_id: userId },
          create: {
            user_id: userId,
            ...payrollUpdate,
          },
          update: payrollUpdate,
        });
      }

      const refreshed = await tx.users.findUnique({
        where: { id: userId },
        include: { trainer: true, payroll: true },
      });

      if (!refreshed) {
        throw new Error('USER_NOT_FOUND');
      }

      return refreshed;
    });

    return successResponse({ user: serializeUser(updated) });
  } catch (error) {
    if (error instanceof Error && error.message === 'USER_NOT_FOUND') {
      return errorResponse('NOT_FOUND', 'Usuario no encontrado', 404);
    }
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
