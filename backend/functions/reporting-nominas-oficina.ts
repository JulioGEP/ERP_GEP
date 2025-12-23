import { Prisma, $Enums, type office_payrolls } from '@prisma/client';

import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { buildMadridDateTime } from './_shared/time';

const ALLOWED_ROLES = ['Admin', 'Administracion', 'People'] as const;

const NON_TRAINER_ROLE_BLOCKLIST: $Enums.erp_role[] = ['formador', 'Formador'];

type DecimalLike = Prisma.Decimal | number | string | null | undefined;

type OfficePayrollResponseItem = {
  id: string | null;
  userId: string;
  fullName: string;
  email: string | null;
  role: string | null;
  year: number;
  month: number;
  startDate: string | null;
  categoria: string | null;
  salarioBruto: number | null;
  aportacionSsIrpf: number | null;
  salarioLimpio: number | null;
  defaultCategoria: string | null;
  defaultSalarioBruto: number | null;
  defaultAportacionSsIrpf: number | null;
  defaultSalarioLimpio: number | null;
  isSaved: boolean;
};

type OfficePayrollResponse = {
  entries: OfficePayrollResponseItem[];
  availableYears: number[];
  latestMonth: { year: number; month: number } | null;
};

type OfficePayrollPayload = {
  userId?: unknown;
  year?: unknown;
  month?: unknown;
  categoria?: unknown;
  salarioBruto?: unknown;
  aportacionSsIrpf?: unknown;
  salarioLimpio?: unknown;
};

function sanitizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function decimalToNumber(value: DecimalLike): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value) : null;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value instanceof Prisma.Decimal) {
    const parsed = value.toNumber();
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseInteger(value: unknown, fallback: number | null = null): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed)) return parsed;
  }
  return fallback;
}

function parseDecimal(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value) : null;
  if (typeof value === 'string') {
    const normalized = value.replace(/%/g, '').replace(/,/g, '.').trim();
    if (!normalized.length) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Number(parsed) : null;
  }
  return null;
}

function toIsoDateString(value: Date | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function clampMonth(value: number | null): number | null {
  if (value === null) return null;
  if (value < 1 || value > 12) return null;
  return value;
}

function buildFullName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  const parts = [firstName, lastName]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
  return parts.length ? parts.join(' ') : (firstName || lastName || '').trim();
}

function serializeRecord(
  record: office_payrolls,
  user: {
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    role: string;
    payroll: any | null;
  },
  startDate: Date | null,
): OfficePayrollResponseItem {
  return {
    id: record.id,
    userId: user.id,
    fullName: buildFullName(user.first_name, user.last_name),
    email: user.email,
    role: user.role,
    year: record.year,
    month: record.month,
    startDate: toIsoDateString(startDate),
    categoria: sanitizeText(record.categoria),
    salarioBruto: decimalToNumber(record.salario_bruto),
    aportacionSsIrpf: decimalToNumber(record.aportacion_ss_irpf),
    salarioLimpio: decimalToNumber(record.salario_limpio),
    defaultCategoria: sanitizeText(user.payroll?.categoria),
    defaultSalarioBruto: decimalToNumber(user.payroll?.salario_bruto),
    defaultAportacionSsIrpf: decimalToNumber(user.payroll?.aportacion_ss_irpf),
    defaultSalarioLimpio: decimalToNumber(user.payroll?.salario_limpio),
    isSaved: true,
  };
}

async function handleGet(prisma = getPrisma(), request: any): Promise<ReturnType<typeof successResponse> | ReturnType<typeof errorResponse>> {
  const filterYear = parseInteger(request.query?.year || request.event?.queryStringParameters?.year, null);

  const nowUtc = new Date();
  const now = buildMadridDateTime({
    year: nowUtc.getUTCFullYear(),
    month: nowUtc.getUTCMonth() + 1,
    day: nowUtc.getUTCDate(),
    hour: nowUtc.getUTCHours(),
    minute: nowUtc.getUTCMinutes(),
  });
  const currentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  type UserWithOfficePayrolls = Prisma.usersGetPayload<{
    select: {
      id: true;
      first_name: true;
      last_name: true;
      email: true;
      role: true;
      created_at: true;
      payroll: true;
      office_payrolls: true;
    };
  }>;

  const users: UserWithOfficePayrolls[] = await prisma.users.findMany({
    where: {
      AND: [
        { role: { notIn: NON_TRAINER_ROLE_BLOCKLIST } },
        { trainer: { is: null } },
      ],
    },
    select: {
      id: true,
      first_name: true,
      last_name: true,
      email: true,
      role: true,
      created_at: true,
      payroll: true,
      office_payrolls: true,
    },
  });

  const entries: OfficePayrollResponseItem[] = [];
  const availableYears = new Set<number>();

  users.forEach((user) => {
    const startDate: Date | null = (user.payroll?.antiguedad as Date | null | undefined) ?? user.created_at ?? null;
    if (!startDate) return;

    const periodStart = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
    if (periodStart > currentMonth) return;

    const savedRecords = new Map<string, office_payrolls>();
    user.office_payrolls.forEach((record: office_payrolls) => {
      savedRecords.set(`${record.year}-${record.month}`, record);
      availableYears.add(record.year);
    });

    let cursor = new Date(currentMonth);
    while (cursor >= periodStart) {
      const year = cursor.getUTCFullYear();
      const month = cursor.getUTCMonth() + 1;
      availableYears.add(year);

      if (!filterYear || filterYear === year) {
        const saved = savedRecords.get(`${year}-${month}`) ?? null;
        if (saved) {
          entries.push(serializeRecord(saved, user, periodStart));
        } else {
          entries.push({
            id: null,
            userId: user.id,
            fullName: buildFullName(user.first_name, user.last_name),
            email: user.email,
            role: user.role,
            year,
            month,
            startDate: toIsoDateString(periodStart),
            categoria: null,
            salarioBruto: null,
            aportacionSsIrpf: null,
            salarioLimpio: null,
            defaultCategoria: sanitizeText(user.payroll?.categoria),
            defaultSalarioBruto: decimalToNumber(user.payroll?.salario_bruto),
            defaultAportacionSsIrpf: decimalToNumber(user.payroll?.aportacion_ss_irpf),
            defaultSalarioLimpio: decimalToNumber(user.payroll?.salario_limpio),
            isSaved: false,
          });
        }
      }

      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - 1, 1));
    }
  });

  entries.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    if (a.month !== b.month) return b.month - a.month;
    return a.fullName.localeCompare(b.fullName, 'es', { sensitivity: 'base' });
  });

  return successResponse({
    entries,
    availableYears: Array.from(availableYears).sort((a, b) => b - a),
    latestMonth: { year: currentMonth.getUTCFullYear(), month: currentMonth.getUTCMonth() + 1 },
  } satisfies OfficePayrollResponse);
}

async function handlePut(prisma = getPrisma(), request: any) {
  if (!request.body) {
    return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
  }

  const payload = request.body as OfficePayrollPayload;
  const userId = typeof payload.userId === 'string' ? payload.userId.trim() : '';
  const year = parseInteger(payload.year, null);
  const month = clampMonth(parseInteger(payload.month, null));

  if (!userId || year === null || month === null) {
    return errorResponse('VALIDATION_ERROR', 'Datos de nómina inválidos', 400);
  }

  const categoria = sanitizeText(payload.categoria);
  const salarioBruto = parseDecimal(payload.salarioBruto);
  const aportacionSsIrpf = parseDecimal(payload.aportacionSsIrpf);
  const salarioLimpio = parseDecimal(payload.salarioLimpio);

  const user = await prisma.users.findFirst({
    where: {
      id: userId,
      AND: [
        { role: { notIn: NON_TRAINER_ROLE_BLOCKLIST } },
        { trainer: { is: null } },
      ],
    },
    select: {
      id: true,
      first_name: true,
      last_name: true,
      email: true,
      role: true,
      created_at: true,
      payroll: true,
    },
  });

  if (!user) {
    return errorResponse('NOT_FOUND', 'Usuario no encontrado o es formador', 404);
  }

  const startDate: Date | null = (user.payroll?.antiguedad as Date | null | undefined) ?? user.created_at ?? null;
  if (!startDate) {
    return errorResponse('VALIDATION_ERROR', 'El usuario no tiene fecha de antigüedad configurada', 400);
  }

  const startPeriod = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  const targetPeriod = new Date(Date.UTC(year, month - 1, 1));
  if (targetPeriod < startPeriod) {
    return errorResponse('VALIDATION_ERROR', 'La nómina no puede ser anterior a la fecha de alta', 400);
  }

  const record = await prisma.office_payrolls.upsert({
    where: { user_id_year_month: { user_id: userId, year, month } },
    update: {
      categoria,
      salario_bruto: salarioBruto === null ? null : new Prisma.Decimal(salarioBruto),
      aportacion_ss_irpf: aportacionSsIrpf === null ? null : new Prisma.Decimal(aportacionSsIrpf),
      salario_limpio: salarioLimpio === null ? null : new Prisma.Decimal(salarioLimpio),
    },
    create: {
      user_id: userId,
      year,
      month,
      categoria,
      salario_bruto: salarioBruto === null ? null : new Prisma.Decimal(salarioBruto),
      aportacion_ss_irpf: aportacionSsIrpf === null ? null : new Prisma.Decimal(aportacionSsIrpf),
      salario_limpio: salarioLimpio === null ? null : new Prisma.Decimal(salarioLimpio),
    },
  });

  return successResponse({
    entry: serializeRecord(record, user, startPeriod),
  });
}

export const handler = createHttpHandler(async (request) => {
  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ALLOWED_ROLES });
  if ('error' in auth) {
    return auth.error;
  }

  if (request.method === 'GET') {
    return handleGet(prisma, request);
  }
  if (request.method === 'PUT') {
    return handlePut(prisma, request);
  }

  return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
});
