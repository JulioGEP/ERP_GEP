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
  total_extras?: DecimalLike;
  dietas?: DecimalLike;
  kilometrajes?: DecimalLike;
  pernocta?: DecimalLike;
  nocturnidad?: DecimalLike;
  festivo?: DecimalLike;
  horas_extras?: DecimalLike;
  otros_gastos?: DecimalLike;
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
  trainerFixedContract: boolean;
  year: number;
  month: number;
  dietas: number | null;
  kilometrajes: number | null;
  pernocta: number | null;
  nocturnidad: number | null;
  festivo: number | null;
  horasExtras: number | null;
  otrosGastos: number | null;
  totalExtras: number | null;
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
  dietas?: unknown;
  kilometrajes?: unknown;
  pernocta?: unknown;
  nocturnidad?: unknown;
  festivo?: unknown;
  horasExtras?: unknown;
  otrosGastos?: unknown;
  totalExtras?: unknown;
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

function buildOfficePayrollCreateData(
  user: {
    id: string;
    payroll: {
      convenio?: string | null;
      categoria?: string | null;
      antiguedad?: Date | null;
      horas_semana?: Prisma.Decimal | number | string | null;
      base_retencion?: Prisma.Decimal | number | string | null;
      base_retencion_detalle?: string | null;
      salario_bruto?: Prisma.Decimal | number | string | null;
      salario_bruto_total?: Prisma.Decimal | number | string | null;
      retencion?: Prisma.Decimal | number | string | null;
      aportacion_ss_irpf?: Prisma.Decimal | number | string | null;
      aportacion_ss_irpf_detalle?: string | null;
      salario_limpio?: Prisma.Decimal | number | string | null;
      contingencias_comunes?: Prisma.Decimal | number | string | null;
      contingencias_comunes_detalle?: string | null;
      total_empresa?: Prisma.Decimal | number | string | null;
    } | null;
  },
  year: number,
  month: number,
): Prisma.office_payrollsCreateInput {
  const payroll = user.payroll;

  return {
    user_id: user.id,
    year,
    month,
    convenio: payroll?.convenio ?? null,
    categoria: payroll?.categoria ?? null,
    antiguedad: payroll?.antiguedad ?? null,
    horas_semana: payroll?.horas_semana ?? null,
    base_retencion: payroll?.base_retencion ?? null,
    base_retencion_detalle: payroll?.base_retencion_detalle ?? null,
    salario_bruto: payroll?.salario_bruto ?? null,
    salario_bruto_total: payroll?.salario_bruto_total ?? null,
    retencion: payroll?.retencion ?? null,
    aportacion_ss_irpf: payroll?.aportacion_ss_irpf ?? null,
    aportacion_ss_irpf_detalle: payroll?.aportacion_ss_irpf_detalle ?? null,
    salario_limpio: payroll?.salario_limpio ?? null,
    contingencias_comunes: payroll?.contingencias_comunes ?? null,
    contingencias_comunes_detalle: payroll?.contingencias_comunes_detalle ?? null,
    total_empresa: payroll?.total_empresa ?? null,
  };
}

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

function calculateExtrasTotal(record: {
  total_extras?: DecimalLike;
  dietas?: DecimalLike;
  kilometrajes?: DecimalLike;
  pernocta?: DecimalLike;
  nocturnidad?: DecimalLike;
  festivo?: DecimalLike;
  horas_extras?: DecimalLike;
  otros_gastos?: DecimalLike;
}): number | null {
  const persistedTotal = decimalToNumber(record.total_extras);
  if (persistedTotal !== null) return persistedTotal;

  const values = [
    record.dietas,
    record.kilometrajes,
    record.pernocta,
    record.nocturnidad,
    record.festivo,
    record.horas_extras,
    record.otros_gastos,
  ]
    .map((value) => decimalToNumber(value))
    .filter((value): value is number => value !== null);

  if (values.length === 0) return null;

  return Number(values.reduce((total, value) => total + value, 0));
}

function serializeRecord(
  record: OfficePayrollRow,
  user: {
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    role: string;
    trainer: { contrato_fijo: boolean } | null;
    payroll: any | null;
  },
  startDate: Date | null,
): OfficePayrollResponseItem {
  const totalExtras = calculateExtrasTotal(record);
  const salarioBruto = decimalToNumber(record.salario_bruto);
  const salarioBrutoTotalPersisted = decimalToNumber(record.salario_bruto_total);
  const salarioBrutoTotalCalculated =
    salarioBruto === null && totalExtras === null ? null : (salarioBruto ?? 0) + (totalExtras ?? 0);
  const salarioBrutoTotal = salarioBrutoTotalPersisted ?? salarioBrutoTotalCalculated;

  return {
    id: record.id,
    userId: user.id,
    fullName: buildFullName(user.first_name, user.last_name),
    email: user.email,
    role: user.role,
    trainerFixedContract: Boolean(user.trainer?.contrato_fijo),
    year: record.year,
    month: record.month,
    dietas: decimalToNumber(record.dietas),
    kilometrajes: decimalToNumber(record.kilometrajes),
    pernocta: decimalToNumber(record.pernocta),
    nocturnidad: decimalToNumber(record.nocturnidad),
    festivo: decimalToNumber(record.festivo),
    horasExtras: decimalToNumber(record.horas_extras),
    otrosGastos: decimalToNumber(record.otros_gastos),
    totalExtras,
    startDate: toIsoDateString(record.antiguedad ?? startDate),
    convenio: sanitizeText(record.convenio),
    categoria: sanitizeText(record.categoria),
    antiguedad: toIsoDateString(record.antiguedad),
    horasSemana: decimalToNumber(record.horas_semana),
    baseRetencion: decimalToNumber(record.base_retencion),
    baseRetencionDetalle: sanitizeText(record.base_retencion_detalle),
    salarioBruto,
    salarioBrutoTotal,
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
      trainer: { select: { contrato_fijo: true } };
      office_payrolls: true;
    };
  }>;

  const users: UserWithOfficePayrolls[] = await prisma.users.findMany({
    where: {
      OR: [
        {
          role: { notIn: NON_TRAINER_ROLE_BLOCKLIST },
          trainer: { is: null },
        },
        { trainer: { is: { contrato_fijo: true } } },
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
      trainer: { select: { contrato_fijo: true } },
      office_payrolls: true,
    },
  });

  const currentYear = currentMonth.getUTCFullYear();
  const currentMonthNumber = currentMonth.getUTCMonth() + 1;
  const createdRecords = await Promise.all(
    users.map(async (user) => {
      const alreadyCreated = user.office_payrolls.some(
        (record) => record.year === currentYear && record.month === currentMonthNumber,
      );
      if (alreadyCreated) return null;

      const startDate: Date | null = (user.payroll?.antiguedad as Date | null | undefined) ?? user.created_at ?? null;
      if (!startDate) return null;
      const periodStart = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
      if (periodStart > currentMonth) return null;

      try {
        const record = await prisma.office_payrolls.create({
          data: buildOfficePayrollCreateData(user, currentYear, currentMonthNumber),
        });
        return { userId: user.id, record };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return null;
        }
        throw error;
      }
    }),
  );

  createdRecords.forEach((created) => {
    if (!created) return;
    const user = users.find((item) => item.id === created.userId);
    if (!user) return;
    user.office_payrolls.push(created.record);
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
            trainerFixedContract: Boolean(user.trainer?.contrato_fijo),
            year,
            month,
            dietas: null,
            kilometrajes: null,
            pernocta: null,
            nocturnidad: null,
            festivo: null,
            horasExtras: null,
            otrosGastos: null,
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
            totalExtras: null,
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

  const hasField = (key: keyof OfficePayrollPayload) =>
    Object.prototype.hasOwnProperty.call(payload, key);
  const hasConvenio = hasField('convenio');
  const hasCategoria = hasField('categoria');
  const hasDietas = hasField('dietas');
  const hasKilometrajes = hasField('kilometrajes');
  const hasPernocta = hasField('pernocta');
  const hasNocturnidad = hasField('nocturnidad');
  const hasFestivo = hasField('festivo');
  const hasHorasExtras = hasField('horasExtras');
  const hasOtrosGastos = hasField('otrosGastos');
  const hasTotalExtras = hasField('totalExtras');
  const hasAntiguedad = hasField('antiguedad');
  const hasHorasSemana = hasField('horasSemana');
  const hasBaseRetencion = hasField('baseRetencion');
  const hasBaseRetencionDetalle = hasField('baseRetencionDetalle');
  const hasSalarioBruto = hasField('salarioBruto');
  const hasSalarioBrutoTotal = hasField('salarioBrutoTotal');
  const hasRetencion = hasField('retencion');
  const hasAportacionSsIrpf = hasField('aportacionSsIrpf');
  const hasAportacionSsIrpfDetalle = hasField('aportacionSsIrpfDetalle');
  const hasSalarioLimpio = hasField('salarioLimpio');
  const hasContingenciasComunes = hasField('contingenciasComunes');
  const hasContingenciasComunesDetalle = hasField('contingenciasComunesDetalle');
  const hasTotalEmpresa = hasField('totalEmpresa');

  const convenio = hasConvenio ? sanitizeText(payload.convenio) : undefined;
  const categoria = hasCategoria ? sanitizeText(payload.categoria) : undefined;
  const dietas = hasDietas ? parseDecimal(payload.dietas) : undefined;
  const kilometrajes = hasKilometrajes ? parseDecimal(payload.kilometrajes) : undefined;
  const pernocta = hasPernocta ? parseDecimal(payload.pernocta) : undefined;
  const nocturnidad = hasNocturnidad ? parseDecimal(payload.nocturnidad) : undefined;
  const festivo = hasFestivo ? parseDecimal(payload.festivo) : undefined;
  const horasExtras = hasHorasExtras ? parseDecimal(payload.horasExtras) : undefined;
  const otrosGastos = hasOtrosGastos ? parseDecimal(payload.otrosGastos) : undefined;
  const totalExtrasInput = hasTotalExtras ? parseDecimal(payload.totalExtras) : undefined;
  const antiguedad = hasAntiguedad ? parseDateOnly(payload.antiguedad) : undefined;
  const horasSemana = hasHorasSemana ? parseDecimal(payload.horasSemana) : undefined;
  const baseRetencion = hasBaseRetencion ? parseDecimal(payload.baseRetencion) : undefined;
  const baseRetencionDetalle = hasBaseRetencionDetalle
    ? sanitizeText(payload.baseRetencionDetalle)
    : undefined;
  const salarioBruto = hasSalarioBruto ? parseDecimal(payload.salarioBruto) : undefined;
  const salarioBrutoTotalInput = hasSalarioBrutoTotal ? parseDecimal(payload.salarioBrutoTotal) : undefined;
  const retencion = hasRetencion ? parseDecimal(payload.retencion) : undefined;
  const aportacionSsIrpf = hasAportacionSsIrpf ? parseDecimal(payload.aportacionSsIrpf) : undefined;
  const aportacionSsIrpfDetalle = hasAportacionSsIrpfDetalle
    ? sanitizeText(payload.aportacionSsIrpfDetalle)
    : undefined;
  const salarioLimpio = hasSalarioLimpio ? parseDecimal(payload.salarioLimpio) : undefined;
  const contingenciasComunes = hasContingenciasComunes ? parseDecimal(payload.contingenciasComunes) : undefined;
  const contingenciasComunesDetalle = hasContingenciasComunesDetalle
    ? sanitizeText(payload.contingenciasComunesDetalle)
    : undefined;
  const totalEmpresa = hasTotalEmpresa ? parseDecimal(payload.totalEmpresa) : undefined;

  const user = await prisma.users.findFirst({
    where: {
      id: userId,
      OR: [
        {
          role: { notIn: NON_TRAINER_ROLE_BLOCKLIST },
          trainer: { is: null },
        },
        { trainer: { is: { contrato_fijo: true } } },
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
      trainer: { select: { contrato_fijo: true } },
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

  const existingRecord = await prisma.office_payrolls.findUnique({
    where: { user_id_year_month: { user_id: userId, year, month } },
  });

  const hasAnyExtrasField =
    hasDietas ||
    hasKilometrajes ||
    hasPernocta ||
    hasNocturnidad ||
    hasFestivo ||
    hasHorasExtras ||
    hasOtrosGastos;

  const currentDietas = decimalToNumber(existingRecord?.dietas);
  const currentKilometrajes = decimalToNumber(existingRecord?.kilometrajes);
  const currentPernocta = decimalToNumber(existingRecord?.pernocta);
  const currentNocturnidad = decimalToNumber(existingRecord?.nocturnidad);
  const currentFestivo = decimalToNumber(existingRecord?.festivo);
  const currentHorasExtras = decimalToNumber(existingRecord?.horas_extras);
  const currentOtrosGastos = decimalToNumber(existingRecord?.otros_gastos);

  const resolvedDietas = hasDietas ? dietas ?? null : currentDietas;
  const resolvedKilometrajes = hasKilometrajes ? kilometrajes ?? null : currentKilometrajes;
  const resolvedPernocta = hasPernocta ? pernocta ?? null : currentPernocta;
  const resolvedNocturnidad = hasNocturnidad ? nocturnidad ?? null : currentNocturnidad;
  const resolvedFestivo = hasFestivo ? festivo ?? null : currentFestivo;
  const resolvedHorasExtras = hasHorasExtras ? horasExtras ?? null : currentHorasExtras;
  const resolvedOtrosGastos = hasOtrosGastos ? otrosGastos ?? null : currentOtrosGastos;

  const resolvedTotalExtras = hasAnyExtrasField
    ? calculateExtrasTotal({
        dietas: resolvedDietas,
        kilometrajes: resolvedKilometrajes,
        pernocta: resolvedPernocta,
        nocturnidad: resolvedNocturnidad,
        festivo: resolvedFestivo,
        horas_extras: resolvedHorasExtras,
        otros_gastos: resolvedOtrosGastos,
      })
    : hasTotalExtras
      ? totalExtrasInput ?? null
      : null;

  const updateData: Prisma.office_payrollsUpdateInput = {};
  if (hasConvenio) updateData.convenio = convenio ?? null;
  if (hasCategoria) updateData.categoria = categoria ?? null;
  if (hasDietas) updateData.dietas = dietas === null ? null : new Prisma.Decimal(dietas);
  if (hasKilometrajes)
    updateData.kilometrajes = kilometrajes === null ? null : new Prisma.Decimal(kilometrajes);
  if (hasPernocta) updateData.pernocta = pernocta === null ? null : new Prisma.Decimal(pernocta);
  if (hasNocturnidad)
    updateData.nocturnidad = nocturnidad === null ? null : new Prisma.Decimal(nocturnidad);
  if (hasFestivo) updateData.festivo = festivo === null ? null : new Prisma.Decimal(festivo);
  if (hasHorasExtras)
    updateData.horas_extras = horasExtras === null ? null : new Prisma.Decimal(horasExtras);
  if (hasOtrosGastos)
    updateData.otros_gastos = otrosGastos === null ? null : new Prisma.Decimal(otrosGastos);
  if (hasAnyExtrasField || hasTotalExtras) {
    updateData.total_extras =
      resolvedTotalExtras === null ? null : new Prisma.Decimal(resolvedTotalExtras);
  }
  if (hasAntiguedad) updateData.antiguedad = antiguedad ?? null;
  if (hasHorasSemana)
    updateData.horas_semana = horasSemana === null ? null : new Prisma.Decimal(horasSemana);
  if (hasBaseRetencion)
    updateData.base_retencion = baseRetencion === null ? null : new Prisma.Decimal(baseRetencion);
  if (hasBaseRetencionDetalle) updateData.base_retencion_detalle = baseRetencionDetalle ?? null;
  if (hasSalarioBruto)
    updateData.salario_bruto = salarioBruto === null ? null : new Prisma.Decimal(salarioBruto);
  if (hasSalarioBrutoTotal) {
    updateData.salario_bruto_total =
      salarioBrutoTotalInput === null ? null : new Prisma.Decimal(salarioBrutoTotalInput);
  }
  if (hasRetencion) updateData.retencion = retencion === null ? null : new Prisma.Decimal(retencion);
  if (hasAportacionSsIrpf)
    updateData.aportacion_ss_irpf =
      aportacionSsIrpf === null ? null : new Prisma.Decimal(aportacionSsIrpf);
  if (hasAportacionSsIrpfDetalle)
    updateData.aportacion_ss_irpf_detalle = aportacionSsIrpfDetalle ?? null;
  if (hasSalarioLimpio)
    updateData.salario_limpio = salarioLimpio === null ? null : new Prisma.Decimal(salarioLimpio);
  if (hasContingenciasComunes)
    updateData.contingencias_comunes =
      contingenciasComunes === null ? null : new Prisma.Decimal(contingenciasComunes);
  if (hasContingenciasComunesDetalle)
    updateData.contingencias_comunes_detalle = contingenciasComunesDetalle ?? null;
  if (hasTotalEmpresa)
    updateData.total_empresa = totalEmpresa === null ? null : new Prisma.Decimal(totalEmpresa);

  const createTotalExtras = calculateExtrasTotal({
    total_extras: totalExtrasInput ?? null,
    dietas: hasDietas ? dietas ?? null : null,
    kilometrajes: hasKilometrajes ? kilometrajes ?? null : null,
    pernocta: hasPernocta ? pernocta ?? null : null,
    nocturnidad: hasNocturnidad ? nocturnidad ?? null : null,
    festivo: hasFestivo ? festivo ?? null : null,
    horas_extras: hasHorasExtras ? horasExtras ?? null : null,
    otros_gastos: hasOtrosGastos ? otrosGastos ?? null : null,
  });

  const record = await prisma.office_payrolls.upsert({
    where: { user_id_year_month: { user_id: userId, year, month } },
    update: updateData,
    create: {
      user_id: userId,
      year,
      month,
      convenio: convenio ?? null,
      categoria: categoria ?? null,
      dietas: hasDietas ? (dietas === null ? null : new Prisma.Decimal(dietas)) : null,
      kilometrajes: hasKilometrajes
        ? kilometrajes === null
          ? null
          : new Prisma.Decimal(kilometrajes)
        : null,
      pernocta: hasPernocta ? (pernocta === null ? null : new Prisma.Decimal(pernocta)) : null,
      nocturnidad: hasNocturnidad
        ? nocturnidad === null
          ? null
          : new Prisma.Decimal(nocturnidad)
        : null,
      festivo: hasFestivo ? (festivo === null ? null : new Prisma.Decimal(festivo)) : null,
      horas_extras: hasHorasExtras
        ? horasExtras === null
          ? null
          : new Prisma.Decimal(horasExtras)
        : null,
      otros_gastos: hasOtrosGastos
        ? otrosGastos === null
          ? null
          : new Prisma.Decimal(otrosGastos)
        : null,
      total_extras: createTotalExtras === null ? null : new Prisma.Decimal(createTotalExtras),
      antiguedad: antiguedad ?? null,
      horas_semana: hasHorasSemana
        ? horasSemana === null
          ? null
          : new Prisma.Decimal(horasSemana)
        : null,
      base_retencion: hasBaseRetencion
        ? baseRetencion === null
          ? null
          : new Prisma.Decimal(baseRetencion)
        : null,
      base_retencion_detalle: baseRetencionDetalle ?? null,
      salario_bruto: hasSalarioBruto
        ? salarioBruto === null
          ? null
          : new Prisma.Decimal(salarioBruto)
        : null,
      salario_bruto_total: hasSalarioBrutoTotal
        ? salarioBrutoTotalInput === null
          ? null
          : new Prisma.Decimal(salarioBrutoTotalInput)
        : null,
      retencion: hasRetencion ? (retencion === null ? null : new Prisma.Decimal(retencion)) : null,
      aportacion_ss_irpf: hasAportacionSsIrpf
        ? aportacionSsIrpf === null
          ? null
          : new Prisma.Decimal(aportacionSsIrpf)
        : null,
      aportacion_ss_irpf_detalle: aportacionSsIrpfDetalle ?? null,
      salario_limpio: hasSalarioLimpio
        ? salarioLimpio === null
          ? null
          : new Prisma.Decimal(salarioLimpio)
        : null,
      contingencias_comunes: hasContingenciasComunes
        ? contingenciasComunes === null
          ? null
          : new Prisma.Decimal(contingenciasComunes)
        : null,
      contingencias_comunes_detalle: contingenciasComunesDetalle ?? null,
      total_empresa: hasTotalEmpresa
        ? totalEmpresa === null
          ? null
          : new Prisma.Decimal(totalEmpresa)
        : null,
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
