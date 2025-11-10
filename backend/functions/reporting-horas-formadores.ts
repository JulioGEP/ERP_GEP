import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { buildMadridDateTime, formatTimeFromDb } from './_shared/time';

type DecimalLike = { toNumber?: () => number; toString?: () => string };

type SessionTrainerRow = {
  sesion_id: string;
  trainer_id: string;
  sesiones: {
    id: string;
    fecha_inicio_utc: Date | null;
    fecha_fin_utc: Date | null;
    deals: { tipo_servicio: string | null } | null;
  } | null;
  trainers: { trainer_id: string; name: string | null; apellido: string | null } | null;
};

type VariantTrainerRow = {
  id: string;
  trainer_id: string | null;
  date: Date | string | null;
  products: { hora_inicio: Date | string | null; hora_fin: Date | string | null } | null;
  trainers: { trainer_id: string; name: string | null; apellido: string | null } | null;
};

type TrainerExtraCostRow = {
  trainer_id: string;
  session_id: string | null;
  variant_id: string | null;
  precio_coste_formacion: DecimalLike | number | string | null;
  precio_coste_preventivo: DecimalLike | number | string | null;
  dietas: DecimalLike | number | string | null;
  kilometraje: DecimalLike | number | string | null;
  pernocta: DecimalLike | number | string | null;
  nocturnidad: DecimalLike | number | string | null;
  festivo: DecimalLike | number | string | null;
  horas_extras: DecimalLike | number | string | null;
  gastos_extras: DecimalLike | number | string | null;
};

type TrainerHoursAccumulator = {
  trainerId: string;
  name: string | null;
  lastName: string | null;
  sessionCount: number;
  totalHours: number;
  serviceCost: number;
  extraCost: number;
};

const DEFAULT_SERVICE_COSTS = {
  formacion: 15,
  preventivo: 15,
} as const;

const EXTRA_COST_COLUMNS = [
  'dietas',
  'kilometraje',
  'pernocta',
  'nocturnidad',
  'festivo',
  'horas_extras',
  'gastos_extras',
] as const;

function computeSessionHours(start: Date | null, end: Date | null): number {
  if (!start || !end) return 0;
  const startTime = start.getTime();
  const endTime = end.getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 0;
  const diff = endTime - startTime;
  if (!Number.isFinite(diff) || diff <= 0) return 0;
  return diff / (60 * 60 * 1000);
}

function normalizeName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function decimalToNumber(value: DecimalLike | number | string | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof (value as DecimalLike).toNumber === 'function') {
    return (value as DecimalLike).toNumber!();
  }
  if (value && typeof (value as DecimalLike).toString === 'function') {
    const parsed = Number((value as DecimalLike).toString!());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function resolveServiceRate(
  record: TrainerExtraCostRow | null,
  type: 'formacion' | 'preventivo',
): number {
  const field = type === 'preventivo' ? 'precio_coste_preventivo' : 'precio_coste_formacion';
  const value = record ? decimalToNumber(record[field]) : 0;
  if (value > 0) {
    return value;
  }
  return DEFAULT_SERVICE_COSTS[type];
}

function sumExtraCosts(record: TrainerExtraCostRow | null): number {
  if (!record) {
    return 0;
  }
  return EXTRA_COST_COLUMNS.reduce((acc, column) => acc + decimalToNumber(record[column]), 0);
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

function isPreventiveService(tipo: string | null | undefined): boolean {
  if (!tipo) {
    return false;
  }
  return tipo.toLowerCase().includes('preventivo');
}

type TimeParts = { hour: number; minute: number };

function extractTimeParts(value: Date | string | null | undefined): TimeParts | null {
  const formatted = formatTimeFromDb(value);
  if (!formatted) return null;
  const match = formatted.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function buildDateTime(date: Date, time: TimeParts | null, fallback: TimeParts): Date {
  const parts = time ?? fallback;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return buildMadridDateTime({ year, month, day, hour: parts.hour, minute: parts.minute });
}

function computeVariantHours(
  variantDate: Date | string | null | undefined,
  productTimes: { hora_inicio: Date | string | null; hora_fin: Date | string | null },
): number {
  if (!variantDate) return 0;

  const parsedDate = new Date(variantDate);
  if (Number.isNaN(parsedDate.getTime())) {
    return 0;
  }

  const startTime = extractTimeParts(productTimes.hora_inicio);
  const endTime = extractTimeParts(productTimes.hora_fin);

  const fallbackStart: TimeParts = startTime ?? { hour: 9, minute: 0 };
  const fallbackEnd: TimeParts = endTime ?? (startTime ? { ...startTime } : { hour: 11, minute: 0 });

  const start = buildDateTime(parsedDate, startTime, fallbackStart);
  let end = buildDateTime(parsedDate, endTime, fallbackEnd);

  if (end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }

  const diff = end.getTime() - start.getTime();
  if (!Number.isFinite(diff) || diff <= 0) {
    return 0;
  }

  return diff / (60 * 60 * 1000);
}

type ParsedDateFilters =
  | { startDate: Date | null; endDate: Date | null }
  | { error: ReturnType<typeof errorResponse> };

function parseDateParts(value: string): { year: number; month: number; day: number } | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  const reference = new Date(Date.UTC(year, month - 1, day));
  if (
    reference.getUTCFullYear() !== year ||
    reference.getUTCMonth() !== month - 1 ||
    reference.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function parseDateFilters(query: Record<string, string | undefined>): ParsedDateFilters {
  const startText = query.startDate?.trim() ?? '';
  const endText = query.endDate?.trim() ?? '';

  let startDate: Date | null = null;
  let endDate: Date | null = null;

  if (startText) {
    const parts = parseDateParts(startText);
    if (!parts) {
      return {
        error: errorResponse('INVALID_DATE', 'La fecha de inicio proporcionada no es válida.', 400),
      };
    }
    startDate = buildMadridDateTime({
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: 0,
      minute: 0,
    });
  }

  if (endText) {
    const parts = parseDateParts(endText);
    if (!parts) {
      return {
        error: errorResponse('INVALID_DATE', 'La fecha de fin proporcionada no es válida.', 400),
      };
    }
    endDate = buildMadridDateTime({
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: 23,
      minute: 59,
    });
  }

  if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
    return {
      error: errorResponse(
        'INVALID_DATE_RANGE',
        'La fecha de inicio no puede ser posterior a la fecha de fin.',
        400,
      ),
    };
  }

  return { startDate, endDate };
}

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ['Admin'] });
  if ('error' in auth) {
    return auth.error;
  }

  const parsedDates = parseDateFilters(request.query);
  if ('error' in parsedDates) {
    return parsedDates.error;
  }

  const { startDate, endDate } = parsedDates;

  const sessionStartFilter: { not: null; gte?: Date; lte?: Date } = { not: null };
  if (startDate) {
    sessionStartFilter.gte = startDate;
  }
  if (endDate) {
    sessionStartFilter.lte = endDate;
  }

  const sessionEndFilter: { not: null; gte?: Date; lte?: Date } = { not: null };

  const sessionWhere = {
    sesiones: {
      fecha_inicio_utc: sessionStartFilter,
      fecha_fin_utc: sessionEndFilter,
    },
  };

  const variantDateFilter: { not: null; gte?: Date; lte?: Date } = { not: null };
  if (startDate) {
    variantDateFilter.gte = startDate;
  }
  if (endDate) {
    variantDateFilter.lte = endDate;
  }

  const rows = (await prisma.sesion_trainers.findMany({
    where: sessionWhere,
    select: {
      sesion_id: true,
      trainer_id: true,
      sesiones: {
        select: {
          id: true,
          fecha_inicio_utc: true,
          fecha_fin_utc: true,
          deals: { select: { tipo_servicio: true } },
        },
      },
      trainers: {
        select: {
          trainer_id: true,
          name: true,
          apellido: true,
        },
      },
    },
  })) as SessionTrainerRow[];

  const variantRows = (await prisma.variants.findMany({
    where: {
      trainer_id: { not: null },
      date: variantDateFilter,
    },
    select: {
      id: true,
      trainer_id: true,
      date: true,
      products: { select: { hora_inicio: true, hora_fin: true } },
      trainers: { select: { trainer_id: true, name: true, apellido: true } },
    },
  })) as VariantTrainerRow[];

  const totals = new Map<string, TrainerHoursAccumulator>();
  const trainerIds = new Set<string>();
  const sessionIds = new Set<string>();
  const variantIds = new Set<string>();

  for (const row of rows) {
    const trainerId = row.trainer_id || row.trainers?.trainer_id;
    if (trainerId) {
      trainerIds.add(trainerId);
    }
    if (row.sesion_id) {
      sessionIds.add(row.sesion_id);
    }
  }

  for (const row of variantRows) {
    const trainerId = row.trainer_id || row.trainers?.trainer_id;
    if (trainerId) {
      trainerIds.add(trainerId);
    }
    if (row.id) {
      variantIds.add(row.id);
    }
  }

  let extraCostRecords: TrainerExtraCostRow[] = [];
  if (trainerIds.size > 0 && (sessionIds.size > 0 || variantIds.size > 0)) {
    const orConditions: Array<Record<string, unknown>> = [];
    if (sessionIds.size > 0) {
      orConditions.push({ session_id: { in: Array.from(sessionIds) } });
    }
    if (variantIds.size > 0) {
      orConditions.push({ variant_id: { in: Array.from(variantIds) } });
    }
    if (orConditions.length > 0) {
      extraCostRecords = (await prisma.trainer_extra_costs.findMany({
        where: {
          trainer_id: { in: Array.from(trainerIds) },
          OR: orConditions,
        },
        select: {
          trainer_id: true,
          session_id: true,
          variant_id: true,
          precio_coste_formacion: true,
          precio_coste_preventivo: true,
          dietas: true,
          kilometraje: true,
          pernocta: true,
          nocturnidad: true,
          festivo: true,
          horas_extras: true,
          gastos_extras: true,
        },
      })) as unknown as TrainerExtraCostRow[];
    }
  }

  const extraCostMap = new Map<string, TrainerExtraCostRow>();
  for (const record of extraCostRecords) {
    const trainerId = record.trainer_id;
    if (record.session_id) {
      extraCostMap.set(`session:${record.session_id}:${trainerId}`, record);
    }
    if (record.variant_id) {
      extraCostMap.set(`variant:${record.variant_id}:${trainerId}`, record);
    }
  }

  for (const row of rows) {
    const trainerId = row.trainer_id || row.trainers?.trainer_id;
    if (!trainerId) {
      continue;
    }

    const sessionId = row.sesion_id || row.sesiones?.id || null;
    const hours = computeSessionHours(
      row.sesiones?.fecha_inicio_utc ?? null,
      row.sesiones?.fecha_fin_utc ?? null,
    );

    const extraCostKey = sessionId ? `session:${sessionId}:${trainerId}` : null;
    const extraCostRecord = extraCostKey ? extraCostMap.get(extraCostKey) ?? null : null;
    const sessionType: 'formacion' | 'preventivo' = isPreventiveService(
      row.sesiones?.deals?.tipo_servicio ?? null,
    )
      ? 'preventivo'
      : 'formacion';
    const serviceRate = resolveServiceRate(extraCostRecord, sessionType);
    const serviceCost = hours * serviceRate;
    const extraCost = sumExtraCosts(extraCostRecord);

    const existing = totals.get(trainerId);
    if (existing) {
      existing.sessionCount += 1;
      existing.totalHours += hours;
      existing.serviceCost += serviceCost;
      existing.extraCost += extraCost;
      if (existing.name === null && normalizeName(row.trainers?.name)) {
        existing.name = normalizeName(row.trainers?.name);
      }
      if (existing.lastName === null && normalizeName(row.trainers?.apellido)) {
        existing.lastName = normalizeName(row.trainers?.apellido);
      }
      continue;
    }

    totals.set(trainerId, {
      trainerId,
      name: normalizeName(row.trainers?.name),
      lastName: normalizeName(row.trainers?.apellido),
      sessionCount: 1,
      totalHours: hours,
      serviceCost,
      extraCost,
    });
  }

  for (const row of variantRows) {
    const trainerId = row.trainer_id || row.trainers?.trainer_id;
    if (!trainerId) {
      continue;
    }

    const hours = computeVariantHours(row.date, row.products ?? { hora_inicio: null, hora_fin: null });
    const variantId = row.id;
    const extraCostKey = `variant:${variantId}:${trainerId}`;
    const extraCostRecord = extraCostMap.get(extraCostKey) ?? null;
    const serviceRate = resolveServiceRate(extraCostRecord, 'formacion');
    const serviceCost = hours * serviceRate;
    const extraCost = sumExtraCosts(extraCostRecord);

    const existing = totals.get(trainerId);
    if (existing) {
      existing.sessionCount += 1;
      existing.totalHours += hours;
      existing.serviceCost += serviceCost;
      existing.extraCost += extraCost;
      if (existing.name === null && normalizeName(row.trainers?.name)) {
        existing.name = normalizeName(row.trainers?.name);
      }
      if (existing.lastName === null && normalizeName(row.trainers?.apellido)) {
        existing.lastName = normalizeName(row.trainers?.apellido);
      }
      continue;
    }

    totals.set(trainerId, {
      trainerId,
      name: normalizeName(row.trainers?.name),
      lastName: normalizeName(row.trainers?.apellido),
      sessionCount: 1,
      totalHours: hours,
      serviceCost,
      extraCost,
    });
  }

  const accumulatedItems = Array.from(totals.values());

  const items = accumulatedItems
    .map((item) => {
      const totalHours = roundToTwoDecimals(item.totalHours);
      const serviceCost = roundToTwoDecimals(item.serviceCost);
      const extraCost = roundToTwoDecimals(item.extraCost);
      const payrollCost = roundToTwoDecimals(item.serviceCost + item.extraCost);
      return {
        trainerId: item.trainerId,
        name: item.name,
        lastName: item.lastName,
        sessionCount: item.sessionCount,
        totalHours,
        serviceCost,
        extraCost,
        payrollCost,
      };
    })
    .sort((a, b) => {
      if (b.totalHours !== a.totalHours) {
        return b.totalHours - a.totalHours;
      }
      if (b.sessionCount !== a.sessionCount) {
        return b.sessionCount - a.sessionCount;
      }
      return a.trainerId.localeCompare(b.trainerId);
    });

  const totalSessions = accumulatedItems.reduce((acc, item) => acc + item.sessionCount, 0);
  const totalHours = roundToTwoDecimals(accumulatedItems.reduce((acc, item) => acc + item.totalHours, 0));
  const totalServiceCost = roundToTwoDecimals(
    accumulatedItems.reduce((acc, item) => acc + item.serviceCost, 0),
  );
  const totalExtraCost = roundToTwoDecimals(
    accumulatedItems.reduce((acc, item) => acc + item.extraCost, 0),
  );
  const totalPayrollCost = roundToTwoDecimals(
    accumulatedItems.reduce((acc, item) => acc + item.serviceCost + item.extraCost, 0),
  );

  return successResponse({
    items,
    summary: {
      totalSessions,
      totalHours,
      totalServiceCost,
      totalExtraCost,
      totalPayrollCost,
    },
  });
});
