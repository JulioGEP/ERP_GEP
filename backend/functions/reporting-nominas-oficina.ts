import { Prisma, $Enums, type office_payrolls } from '@prisma/client';

import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { buildMadridDateTime } from './_shared/time';

const ALLOWED_ROLES = ['Admin', 'Administracion', 'People'] as const;

const NON_TRAINER_ROLE_BLOCKLIST: $Enums.erp_role[] = ['formador', 'Formador'];

type DecimalLike = Prisma.Decimal | number | string | null | undefined;

type OfficePayrollRow = office_payrolls & {
  convenio?: string | null;
  antiguedad?: Date | null;
  horas_semana?: DecimalLike;
  base_retencion?: DecimalLike;
  base_retencion_detalle?: string | null;
  salario_bruto_total?: DecimalLike;
  retencion?: DecimalLike;
  aportacion_ss_irpf_detalle?: string | null;
  contingencias_comunes?: DecimalLike;
  contingencias_comunes_detalle?: string | null;
  total_empresa?: DecimalLike;
};

type OfficePayrollResponseItem = {
  id: string | null;
  userId: string;
  fullName: string;
  email: string | null;
  role: string | null;
  year: number;
  month: number;
  startDate: string | null;
  convenio: string | null;
  categoria: string | null;
  antiguedad: string | null;
  horasSemana: number | null;
  baseRetencion: number | null;
  baseRetencionDetalle: string | null;
  salarioBruto: number | null;
  salarioBrutoTotal: number | null;
  retencion: number | null;
  aportacionSsIrpf: number | null;
  aportacionSsIrpfDetalle: string | null;
  salarioLimpio: number | null;
  contingenciasComunes: number | null;
  contingenciasComunesDetalle: string | null;
  totalEmpresa: number | null;
  defaultConvenio: string | null;
  defaultCategoria: string | null;
  defaultAntiguedad: string | null;
  defaultHorasSemana: number | null;
  defaultBaseRetencion: number | null;
  defaultBaseRetencionDetalle: string | null;
  defaultSalarioBruto: number | null;
  defaultSalarioBrutoTotal: number | null;
  defaultRetencion: number | null;
  defaultAportacionSsIrpf: number | null;
  defaultAportacionSsIrpfDetalle: string | null;
  defaultSalarioLimpio: number | null;
  defaultContingenciasComunes: number | null;
  defaultContingenciasComunesDetalle: string | null;
  defaultTotalEmpresa: number | null;
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
  convenio?: unknown;
  antiguedad?: unknown;
  horasSemana?: unknown;
  baseRetencion?: unknown;
  baseRetencionDetalle?: unknown;
  salarioBrutoTotal?: unknown;
  retencion?: unknown;
  aportacionSsIrpfDetalle?: unknown;
  contingenciasComunes?: unknown;
  contingenciasComunesDetalle?: unknown;
  totalEmpresa?: unknown;
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

function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const [year, month, day] = normalized.split('-').map((part) => Number(part));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isFinite(date.getTime()) ? date : null;
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
  record: OfficePayrollRow,
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
    startDate: toIsoDateString(record.antiguedad ?? startDate),
    convenio: sanitizeText(record.convenio),
    categoria: sanitizeText(record.categoria),
    antiguedad: toIsoDateString(record.antiguedad),
    horasSemana: decimalToNumber(record.horas_semana),
    baseRetencion: decimalToNumber(record.base_retencion),
    baseRetencionDetalle: sanitizeText(record.base_retencion_detalle),
    salarioBruto: decimalToNumber(record.salario_bruto),
    salarioBrutoTotal: decimalToNumber(record.salario_bruto_total),
    retencion: decimalToNumber(record.retencion),
    aportacionSsIrpf: decimalToNumber(record.aportacion_ss_irpf),
    aportacionSsIrpfDetalle: sanitizeText(record.aportacion_ss_irpf_detalle),
    salarioLimpio: decimalToNumber(record.salario_limpio),
    contingenciasComunes: decimalToNumber(record.contingencias_comunes),
    contingenciasComunesDetalle: sanitizeText(record.contingencias_comunes_detalle),
    totalEmpresa: decimalToNumber(record.total_empresa),
    defaultConvenio: sanitizeText(user.payroll?.convenio),
    defaultCategoria: sanitizeText(user.payroll?.categoria),
    defaultAntiguedad: toIsoDateString(user.payroll?.antiguedad as Date | null | undefined),
    defaultHorasSemana: decimalToNumber(user.payroll?.horas_semana),
    defaultBaseRetencion: decimalToNumber(user.payroll?.base_retencion),
    defaultBaseRetencionDetalle: sanitizeText(user.payroll?.base_retencion_detalle),
    defaultSalarioBruto: decimalToNumber(user.payroll?.salario_bruto),
    defaultSalarioBrutoTotal: decimalToNumber(user.payroll?.salario_bruto_total),
    defaultRetencion: decimalToNumber(user.payroll?.retencion),
    defaultAportacionSsIrpf: decimalToNumber(user.payroll?.aportacion_ss_irpf),
    defaultAportacionSsIrpfDetalle: sanitizeText(user.payroll?.aportacion_ss_irpf_detalle),
    defaultSalarioLimpio: decimalToNumber(user.payroll?.salario_limpio),
    defaultContingenciasComunes: decimalToNumber(user.payroll?.contingencias_comunes),
    defaultContingenciasComunesDetalle: sanitizeText(user.payroll?.contingencias_comunes_detalle),
    defaultTotalEmpresa: decimalToNumber(user.payroll?.total_empresa),
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

    const savedRecords = new Map<string, OfficePayrollRow>();
    user.office_payrolls.forEach((record: OfficePayrollRow) => {
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
            convenio: null,
            categoria: null,
            antiguedad: null,
            horasSemana: null,
            baseRetencion: null,
            baseRetencionDetalle: null,
            salarioBruto: null,
            salarioBrutoTotal: null,
            retencion: null,
            aportacionSsIrpf: null,
            aportacionSsIrpfDetalle: null,
            salarioLimpio: null,
            contingenciasComunes: null,
            contingenciasComunesDetalle: null,
            totalEmpresa: null,
            defaultConvenio: sanitizeText(user.payroll?.convenio),
            defaultCategoria: sanitizeText(user.payroll?.categoria),
            defaultAntiguedad: toIsoDateString(user.payroll?.antiguedad as Date | null | undefined),
            defaultHorasSemana: decimalToNumber(user.payroll?.horas_semana),
            defaultBaseRetencion: decimalToNumber(user.payroll?.base_retencion),
            defaultBaseRetencionDetalle: sanitizeText(user.payroll?.base_retencion_detalle),
            defaultSalarioBruto: decimalToNumber(user.payroll?.salario_bruto),
            defaultSalarioBrutoTotal: decimalToNumber(user.payroll?.salario_bruto_total),
            defaultRetencion: decimalToNumber(user.payroll?.retencion),
            defaultAportacionSsIrpf: decimalToNumber(user.payroll?.aportacion_ss_irpf),
            defaultAportacionSsIrpfDetalle: sanitizeText(user.payroll?.aportacion_ss_irpf_detalle),
            defaultSalarioLimpio: decimalToNumber(user.payroll?.salario_limpio),
            defaultContingenciasComunes: decimalToNumber(user.payroll?.contingencias_comunes),
            defaultContingenciasComunesDetalle: sanitizeText(user.payroll?.contingencias_comunes_detalle),
            defaultTotalEmpresa: decimalToNumber(user.payroll?.total_empresa),
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

  const convenio = sanitizeText(payload.convenio);
  const categoria = sanitizeText(payload.categoria);
  const antiguedad = parseDateOnly(payload.antiguedad);
  const horasSemana = parseDecimal(payload.horasSemana);
  const baseRetencion = parseDecimal(payload.baseRetencion);
  const baseRetencionDetalle = sanitizeText(payload.baseRetencionDetalle);
  const salarioBruto = parseDecimal(payload.salarioBruto);
  const salarioBrutoTotal = parseDecimal(payload.salarioBrutoTotal);
  const retencion = parseDecimal(payload.retencion);
  const aportacionSsIrpf = parseDecimal(payload.aportacionSsIrpf);
  const aportacionSsIrpfDetalle = sanitizeText(payload.aportacionSsIrpfDetalle);
  const salarioLimpio = parseDecimal(payload.salarioLimpio);
  const contingenciasComunes = parseDecimal(payload.contingenciasComunes);
  const contingenciasComunesDetalle = sanitizeText(payload.contingenciasComunesDetalle);
  const totalEmpresa = parseDecimal(payload.totalEmpresa);

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
      convenio,
      categoria,
      antiguedad,
      horas_semana: horasSemana === null ? null : new Prisma.Decimal(horasSemana),
      base_retencion: baseRetencion === null ? null : new Prisma.Decimal(baseRetencion),
      base_retencion_detalle: baseRetencionDetalle,
      salario_bruto: salarioBruto === null ? null : new Prisma.Decimal(salarioBruto),
      salario_bruto_total: salarioBrutoTotal === null ? null : new Prisma.Decimal(salarioBrutoTotal),
      retencion: retencion === null ? null : new Prisma.Decimal(retencion),
      aportacion_ss_irpf: aportacionSsIrpf === null ? null : new Prisma.Decimal(aportacionSsIrpf),
      aportacion_ss_irpf_detalle: aportacionSsIrpfDetalle,
      salario_limpio: salarioLimpio === null ? null : new Prisma.Decimal(salarioLimpio),
      contingencias_comunes: contingenciasComunes === null ? null : new Prisma.Decimal(contingenciasComunes),
      contingencias_comunes_detalle: contingenciasComunesDetalle,
      total_empresa: totalEmpresa === null ? null : new Prisma.Decimal(totalEmpresa),
    },
    create: {
      user_id: userId,
      year,
      month,
      convenio,
      categoria,
      antiguedad,
      horas_semana: horasSemana === null ? null : new Prisma.Decimal(horasSemana),
      base_retencion: baseRetencion === null ? null : new Prisma.Decimal(baseRetencion),
      base_retencion_detalle: baseRetencionDetalle,
      salario_bruto: salarioBruto === null ? null : new Prisma.Decimal(salarioBruto),
      salario_bruto_total: salarioBrutoTotal === null ? null : new Prisma.Decimal(salarioBrutoTotal),
      retencion: retencion === null ? null : new Prisma.Decimal(retencion),
      aportacion_ss_irpf: aportacionSsIrpf === null ? null : new Prisma.Decimal(aportacionSsIrpf),
      aportacion_ss_irpf_detalle: aportacionSsIrpfDetalle,
      salario_limpio: salarioLimpio === null ? null : new Prisma.Decimal(salarioLimpio),
      contingencias_comunes: contingenciasComunes === null ? null : new Prisma.Decimal(contingenciasComunes),
      contingencias_comunes_detalle: contingenciasComunesDetalle,
      total_empresa: totalEmpresa === null ? null : new Prisma.Decimal(totalEmpresa),
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
