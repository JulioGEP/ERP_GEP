import { Prisma } from '@prisma/client';
import { join, sqltag, type Sql } from '@prisma/client/runtime/library';

import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { buildMadridDateTime } from './_shared/time';

const sql = sqltag;
type DecimalLike = { toNumber?: () => number; toString?: () => string };

const COST_FIELD_DEFINITIONS = [
  { key: 'precioCosteFormacion', column: 'precio_coste_formacion' },
  { key: 'precioCostePreventivo', column: 'precio_coste_preventivo' },
  { key: 'dietas', column: 'dietas' },
  { key: 'kilometraje', column: 'kilometraje' },
  { key: 'pernocta', column: 'pernocta' },
  { key: 'nocturnidad', column: 'nocturnidad' },
  { key: 'festivo', column: 'festivo' },
  { key: 'horasExtras', column: 'horas_extras' },
  { key: 'gastosExtras', column: 'gastos_extras' },
] as const;

type CostFieldDefinition = (typeof COST_FIELD_DEFINITIONS)[number];
export type CostFieldKey = CostFieldDefinition['key'];

const DEFAULT_COST_VALUES: Partial<Record<CostFieldKey, number>> = {
  precioCosteFormacion: 15,
  precioCostePreventivo: 15,
};

type TrainerSummary = {
  trainer_id: string;
  name: string | null;
  apellido: string | null;
  contrato_fijo?: boolean | null;
  user_id?: string | null;
};

type SessionInfo = {
  id: string;
  deal_id: string | null;
  nombre_cache: string | null;
  fecha_inicio_utc: Date | null;
  fecha_fin_utc: Date | null;
  tiempo_parada: DecimalLike | number | string | null;
  direccion: string | null;
  deal_products: { name: string | null } | null;
  deals: { title: string | null; pipeline_label: string | null; pipeline_id: string | null } | null;
};

type VariantInfo = {
  id: string;
  name: string | null;
  date: Date | null;
  sede: string | null;
  products: { name: string | null } | null;
};

type ExtraCostRecord = {
  id: string;
  trainer_id: string;
  session_id: string | null;
  variant_id: string | null;
  precio_coste_formacion: DecimalLike | number | string;
  precio_coste_preventivo: DecimalLike | number | string;
  dietas: DecimalLike | number | string;
  kilometraje: DecimalLike | number | string;
  pernocta: DecimalLike | number | string;
  nocturnidad: DecimalLike | number | string;
  festivo: DecimalLike | number | string;
  horas_extras: DecimalLike | number | string;
  gastos_extras: DecimalLike | number | string;
  notas: string | null;
  created_at: Date;
  updated_at: Date;
};

type SessionAssignmentRow = {
  sesion_id: string;
  trainer_id: string;
  sesiones: SessionInfo | null;
};

type VariantAssignmentRow = {
  variant_id: string;
  trainer_id: string;
};

type TrainerExtraCostResponseItem = {
  key: string;
  recordId: string | null;
  trainerId: string;
  trainerName: string | null;
  trainerLastName: string | null;
  trainerUserId: string | null;
  assignmentType: 'session' | 'variant';
  sessionId: string | null;
  variantId: string | null;
  sessionName: string | null;
  variantName: string | null;
  dealTitle: string | null;
  pipelineLabel: string | null;
  productName: string | null;
  site: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  workedHours: number | null;
  costs: Record<CostFieldKey, number>;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  trainerExpenseDocuments: TrainerExpenseDocument[];
};

type TrainerExpenseDocument = {
  id: string;
  sessionId: string;
  trainerId: string | null;
  name: string | null;
  url: string | null;
  addedAt: string | null;
};

type ParsedDateFilters =
  | { startDate: Date | null; endDate: Date | null }
  | { error: ReturnType<typeof errorResponse> };

type TrainerExtraCostResponse = {
  items: TrainerExtraCostResponseItem[];
};

type TrainerExtraCostSavePayload = {
  trainerId?: unknown;
  sessionId?: unknown;
  sesionId?: unknown;
  variantId?: unknown;
  costs?: unknown;
  notes?: unknown;
};

type ParsedCostValues = Partial<Record<CostFieldKey, number>>;

type CostColumnName = (typeof COST_FIELD_DEFINITIONS)[number]['column'];
type TrainerExtraCostNumericMap = Partial<Record<CostColumnName, string | number>>;
type TrainerExtraCostMutationData = TrainerExtraCostNumericMap & { notas?: string | null };
type TrainerExtraCostCreateData = TrainerExtraCostNumericMap & {
  trainer_id: string;
  session_id?: string | null;
  variant_id?: string | null;
  notas?: string | null;
};
type TrainerExtraCostMutationTarget = TrainerExtraCostNumericMap & { notas?: string | null };

function toTrimmedString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return date.toISOString();
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

function buildMonthBoundaries(date: Date): { start: Date; end: Date } | null {
  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { start, end };
}

type PayrollDelta = {
  dietas: number;
  kilometrajes: number;
  pernocta: number;
  nocturnidad: number;
  festivo: number;
  horas_extras: number;
  otros_gastos: number;
  total_extras: number;
};

const PAYROLL_DELTA_FIELDS: Array<{ key: keyof ExtraCostRecord; payrollKey: keyof PayrollDelta }> = [
  { key: 'dietas', payrollKey: 'dietas' },
  { key: 'kilometraje', payrollKey: 'kilometrajes' },
  { key: 'pernocta', payrollKey: 'pernocta' },
  { key: 'nocturnidad', payrollKey: 'nocturnidad' },
  { key: 'festivo', payrollKey: 'festivo' },
  { key: 'horas_extras', payrollKey: 'horas_extras' },
  { key: 'gastos_extras', payrollKey: 'otros_gastos' },
];

function buildPayrollDelta(
  before: Partial<ExtraCostRecord> | null,
  after: ExtraCostRecord,
): PayrollDelta {
  const delta: PayrollDelta = {
    dietas: 0,
    kilometrajes: 0,
    pernocta: 0,
    nocturnidad: 0,
    festivo: 0,
    horas_extras: 0,
    otros_gastos: 0,
    total_extras: 0,
  };

  for (const field of PAYROLL_DELTA_FIELDS) {
    const previousValue = decimalToNumber(before?.[field.key] ?? 0);
    const nextValue = decimalToNumber(after[field.key] ?? 0);
    const diff = Math.round((nextValue - previousValue) * 100) / 100;
    delta[field.payrollKey] = diff;
    delta.total_extras += diff;
  }

  delta.total_extras = Math.round(delta.total_extras * 100) / 100;
  return delta;
}

async function applyPayrollDelta(
  prisma: ReturnType<typeof getPrisma>,
  trainer: TrainerSummary,
  periodDate: Date | null | undefined,
  delta: PayrollDelta,
) {
  if (!trainer.contrato_fijo || !trainer.user_id || !periodDate) {
    return;
  }

  const boundaries = buildMonthBoundaries(periodDate);
  if (!boundaries) {
    return;
  }

  const year = boundaries.start.getUTCFullYear();
  const month = boundaries.start.getUTCMonth() + 1;

  const existing = await prisma.office_payrolls.findUnique({
    where: { user_id_year_month: { user_id: trainer.user_id, year, month } },
  });

  const hasDelta = Object.values(delta).some((value) => Math.abs(value) > 0.001);
  if (!hasDelta) {
    return;
  }

  const toDecimal = (value: number) => new Prisma.Decimal(Math.round(value * 100) / 100);

  const nextValues = {
    dietas: decimalToNumber(existing?.dietas ?? 0) + delta.dietas,
    kilometrajes: decimalToNumber(existing?.kilometrajes ?? 0) + delta.kilometrajes,
    pernocta: decimalToNumber(existing?.pernocta ?? 0) + delta.pernocta,
    nocturnidad: decimalToNumber(existing?.nocturnidad ?? 0) + delta.nocturnidad,
    festivo: decimalToNumber(existing?.festivo ?? 0) + delta.festivo,
    horas_extras: decimalToNumber(existing?.horas_extras ?? 0) + delta.horas_extras,
    otros_gastos: decimalToNumber(existing?.otros_gastos ?? 0) + delta.otros_gastos,
  };
  const nextTotalExtras =
    Math.round(
      Object.values(nextValues).reduce((acc, value) => acc + value, 0) * 100,
    ) / 100;

  const updateData: Prisma.office_payrollsUpdateInput = {};

  (Object.keys(nextValues) as Array<keyof typeof nextValues>).forEach((key) => {
    if (!existing) return;
    const diff =
      Math.round((nextValues[key] - decimalToNumber(existing?.[key] ?? 0)) * 100) / 100;
    if (Math.abs(diff) > 0.001) {
      updateData[key] = toDecimal(nextValues[key]);
    }
  });

  if (existing) {
    const currentTotalExtras = existing.total_extras;
    const currentTotalValue = decimalToNumber(currentTotalExtras ?? 0);
    if (currentTotalExtras === null || Math.abs(nextTotalExtras - currentTotalValue) > 0.001) {
      updateData.total_extras = toDecimal(nextTotalExtras);
    }
  }

  if (existing) {
    if (Object.keys(updateData).length === 0) {
      return;
    }
    await prisma.office_payrolls.update({
      where: { user_id_year_month: { user_id: trainer.user_id, year, month } },
      data: updateData,
    });
    return;
  }

  const createData: Prisma.office_payrollsCreateInput = {
    user_id: trainer.user_id,
    year,
    month,
    dietas: toDecimal(nextValues.dietas),
    kilometrajes: toDecimal(nextValues.kilometrajes),
    pernocta: toDecimal(nextValues.pernocta),
    nocturnidad: toDecimal(nextValues.nocturnidad),
    festivo: toDecimal(nextValues.festivo),
    horas_extras: toDecimal(nextValues.horas_extras),
    otros_gastos: toDecimal(nextValues.otros_gastos),
    total_extras: toDecimal(nextTotalExtras),
  };

  await prisma.office_payrolls.create({ data: createData });
}

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
    reference.getUTCMonth() + 1 !== month ||
    reference.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function parseDateFilters(query: Record<string, string | undefined>): ParsedDateFilters {
  const startRaw = toTrimmedString(query.startDate);
  const endRaw = toTrimmedString(query.endDate);

  let startDate: Date | null = null;
  let endDate: Date | null = null;

  if (startRaw) {
    const parts = parseDateParts(startRaw);
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

  if (endRaw) {
    const parts = parseDateParts(endRaw);
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

  if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
    return {
      error: errorResponse(
        'INVALID_RANGE',
        'La fecha de inicio no puede ser posterior a la fecha de fin.',
        400,
      ),
    };
  }

  return { startDate, endDate };
}

function buildCostKey(type: 'session' | 'variant', assignmentId: string, trainerId: string): string {
  return `${type}:${assignmentId}:${trainerId}`;
}

function createEmptyCosts(): Record<CostFieldKey, number> {
  const result: Record<CostFieldKey, number> = {} as Record<CostFieldKey, number>;
  for (const definition of COST_FIELD_DEFINITIONS) {
    result[definition.key] = DEFAULT_COST_VALUES[definition.key] ?? 0;
  }
  return result;
}

function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

function computeSessionWorkedHours(sessionInfo: SessionInfo | null): number | null {
  if (!sessionInfo?.fecha_inicio_utc || !sessionInfo?.fecha_fin_utc) {
    return null;
  }
  const startTime = sessionInfo.fecha_inicio_utc.getTime();
  const endTime = sessionInfo.fecha_fin_utc.getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return null;
  }
  const diff = endTime - startTime;
  if (!Number.isFinite(diff) || diff <= 0) {
    return 0;
  }
  const totalHours = diff / (60 * 60 * 1000);
  const breakHours = Math.max(0, decimalToNumber(sessionInfo.tiempo_parada));
  return roundToTwoDecimals(Math.max(0, totalHours - breakHours));
}

function mapResponseItem(params: {
  key: string;
  record: ExtraCostRecord | null;
  trainer: TrainerSummary | null;
  assignmentType: 'session' | 'variant';
  sessionInfo?: SessionInfo | null;
  variantInfo?: VariantInfo | null;
  expenseDocuments?: TrainerExpenseDocument[] | null;
}): TrainerExtraCostResponseItem {
  const {
    key,
    record,
    trainer,
    assignmentType,
    sessionInfo = null,
    variantInfo = null,
    expenseDocuments = [],
  } = params;
  const costs = createEmptyCosts();

  if (record) {
    for (const definition of COST_FIELD_DEFINITIONS) {
      const rawValue = (record as Record<string, unknown>)[definition.column] as
        | DecimalLike
        | number
        | string
        | null
        | undefined;
      costs[definition.key] = decimalToNumber(rawValue);
    }
  }

  return {
    key,
    recordId: record?.id ?? null,
    trainerId: trainer?.trainer_id ?? record?.trainer_id ?? '',
    trainerName: trainer?.name ?? null,
    trainerLastName: trainer?.apellido ?? null,
    trainerUserId: trainer?.user_id ?? null,
    assignmentType,
    sessionId: assignmentType === 'session' ? sessionInfo?.id ?? record?.session_id ?? null : null,
    variantId: assignmentType === 'variant' ? variantInfo?.id ?? record?.variant_id ?? null : null,
    sessionName: sessionInfo?.nombre_cache ?? null,
    variantName: variantInfo?.name ?? null,
    dealTitle: sessionInfo?.deals?.title ?? null,
    pipelineLabel: sessionInfo?.deals?.pipeline_label ?? sessionInfo?.deals?.pipeline_id ?? null,
    productName: sessionInfo?.deal_products?.name ?? variantInfo?.products?.name ?? null,
    site: assignmentType === 'session' ? sessionInfo?.direccion ?? null : variantInfo?.sede ?? null,
    scheduledStart:
      assignmentType === 'session'
        ? toIsoString(sessionInfo?.fecha_inicio_utc ?? null)
        : toIsoString(variantInfo?.date ?? null),
    scheduledEnd:
      assignmentType === 'session'
        ? toIsoString(sessionInfo?.fecha_fin_utc ?? null)
        : null,
    workedHours: assignmentType === 'session' ? computeSessionWorkedHours(sessionInfo) : null,
    costs,
    notes: record?.notas ?? null,
    createdAt: toIsoString(record?.created_at ?? null),
    updatedAt: toIsoString(record?.updated_at ?? null),
    trainerExpenseDocuments: expenseDocuments ?? [],
  };
}

function mapTrainerExpenseDocument(entry: any): TrainerExpenseDocument | null {
  const sessionId = normalizeIdentifier(entry?.sesion_id ?? entry?.session_id);
  const id = normalizeIdentifier(entry?.id);
  const trainerId = normalizeIdentifier(entry?.trainer_expense_trainer_id);

  if (!sessionId || !id) {
    return null;
  }

  const name = toTrimmedString(entry?.drive_file_name);
  const url = toTrimmedString(entry?.drive_web_view_link);

  return {
    id,
    sessionId,
    trainerId,
    name: name.length ? name : null,
    url: url.length ? url : null,
    addedAt: toIsoString(entry?.added_at ?? null),
  } satisfies TrainerExpenseDocument;
}

function filterTrainerExpenseDocuments(
  documents: TrainerExpenseDocument[],
  trainerId: string | null,
): TrainerExpenseDocument[] {
  if (!documents.length) return documents;
  if (!trainerId) return documents;

  return documents.filter((doc) => !doc.trainerId || doc.trainerId === trainerId);
}

function parseAmountInput(value: unknown): number | null {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return 0;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    return Math.round(value * 100) / 100;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.length) {
      return 0;
    }
    const normalized = trimmed.replace(',', '.');
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return Math.round(parsed * 100) / 100;
  }
  return null;
}

function parseCostValues(payload: Record<string, unknown>):
  | { values: ParsedCostValues }
  | { error: ReturnType<typeof errorResponse> } {
  const result: ParsedCostValues = {};

  for (const definition of COST_FIELD_DEFINITIONS) {
    const rawValue = payload[definition.key];
    if (rawValue === undefined) {
      continue;
    }
    const parsed = parseAmountInput(rawValue);
    if (parsed === null) {
      return {
        error: errorResponse(
          'INVALID_AMOUNT',
          `El valor para "${definition.key}" debe ser numérico.`,
          400,
        ),
      };
    }
    result[definition.key] = parsed;
  }

  return { values: result };
}

function parseNotes(payload: Record<string, unknown>):
  | { value: string | null; provided: boolean }
  | { error: ReturnType<typeof errorResponse> } {
  if (!Object.prototype.hasOwnProperty.call(payload, 'notes')) {
    return { value: null, provided: false };
  }

  const raw = payload.notes;
  if (raw === null || raw === undefined) {
    return { value: null, provided: true };
  }
  if (typeof raw !== 'string') {
    return {
      error: errorResponse('INVALID_NOTES', 'Las notas deben ser texto.', 400),
    };
  }
  const trimmed = raw.trim();
  return { value: trimmed.length ? trimmed : null, provided: true };
}

function buildCostUpdateData(values: ParsedCostValues): TrainerExtraCostMutationData {
  const data: TrainerExtraCostMutationData = {};
  for (const definition of COST_FIELD_DEFINITIONS) {
    if (values[definition.key] !== undefined) {
      data[definition.column] = formatAmount(values[definition.key]!);
    }
  }
  return data;
}

function buildCostCreateData(
  trainerId: string,
  sessionId: string | null,
  variantId: string | null,
  values: ParsedCostValues,
  notes: string | null,
): TrainerExtraCostCreateData {
  const data: TrainerExtraCostCreateData = {
    trainer_id: trainerId,
    session_id: sessionId,
    variant_id: variantId,
    notas: notes,
  };
  for (const definition of COST_FIELD_DEFINITIONS) {
    const resolvedAmount =
      values[definition.key] ?? DEFAULT_COST_VALUES[definition.key] ?? 0;
    data[definition.column] = formatAmount(resolvedAmount);
  }
  return data;
}

function normalizeIdentifier(value: unknown): string | null {
  const text = toTrimmedString(value);
  return text.length ? text : null;
}

async function ensureTrainerAssignedToVariant(
  prisma: ReturnType<typeof getPrisma>,
  trainerId: string,
  variantId: string,
): Promise<boolean> {
  const variant = await prisma.variants.findUnique({
    where: { id: variantId },
    select: { trainer_id: true },
  });

  if (!variant) {
    return false;
  }

  if (variant.trainer_id === trainerId) {
    return true;
  }

  try {
    const rawRows = await prisma.$queryRaw(
      sql`
        SELECT trainer_id::text AS trainer_id
        FROM variant_trainer_links
        WHERE variant_id = ${variantId}::uuid
          AND trainer_id = ${trainerId}
        LIMIT 1
      `,
    );
    const rows = (rawRows as Array<{ trainer_id: string }> | null | undefined) ?? [];
    return rows.some((row) => row.trainer_id === trainerId);
  } catch (error) {
    if (error instanceof Error && /variant_trainer_links/i.test(error.message)) {
      return false;
    }
    throw error;
  }
}

async function fetchVariantAssignments(
  prisma: ReturnType<typeof getPrisma>,
  startDate: Date | null,
  endDate: Date | null,
): Promise<Map<string, Set<string>>> {
  const assignments = new Map<string, Set<string>>();

  const directVariants = (await prisma.variants.findMany({
    where: {
      trainer_id: { not: null },
      ...(startDate || endDate
        ? {
            date: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {}),
            },
          }
        : {}),
    },
    select: {
      id: true,
      trainer_id: true,
    },
  })) as Array<{ id: string | null; trainer_id: string | null }>;

  for (const variant of directVariants) {
    const variantId = normalizeIdentifier(variant.id);
    const trainerId = normalizeIdentifier(variant.trainer_id);
    if (!variantId || !trainerId) {
      continue;
    }
    if (!assignments.has(variantId)) {
      assignments.set(variantId, new Set());
    }
    assignments.get(variantId)!.add(trainerId);
  }

  const conditions: Sql[] = [];
  if (startDate) {
    conditions.push(sql`v.date >= ${startDate}`);
  }
  if (endDate) {
    conditions.push(sql`v.date <= ${endDate}`);
  }
  const whereClause = conditions.length > 0 ? join(conditions, ' AND ') : sql`TRUE`;

  try {
    const rawAssignments = await prisma.$queryRaw(
      sql`
        SELECT vtl.variant_id::text AS variant_id, vtl.trainer_id::text AS trainer_id
        FROM variant_trainer_links vtl
        JOIN variants v ON v.id = vtl.variant_id
        WHERE ${whereClause}
      `,
    );
    const linkedAssignments =
      (rawAssignments as VariantAssignmentRow[] | null | undefined) ?? [];

    for (const row of linkedAssignments) {
      const variantId = normalizeIdentifier(row.variant_id);
      const trainerId = normalizeIdentifier(row.trainer_id);
      if (!variantId || !trainerId) {
        continue;
      }
      if (!assignments.has(variantId)) {
        assignments.set(variantId, new Set());
      }
      assignments.get(variantId)!.add(trainerId);
    }
  } catch (error) {
    if (!(error instanceof Error && /variant_trainer_links/i.test(error.message))) {
      throw error;
    }
  }

  return assignments;
}

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET' && request.method !== 'PUT') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ['Admin'] });
  if ('error' in auth) {
    return auth.error;
  }

  if (request.method === 'GET') {
    const parsedFilters = parseDateFilters(request.query);
    if ('error' in parsedFilters) {
      return parsedFilters.error;
    }

    const { startDate, endDate } = parsedFilters;

    const sessionWhere: Record<string, unknown> = {};
    if (startDate || endDate) {
      const dateFilter: { gte?: Date; lte?: Date } = {};
      if (startDate) {
        dateFilter.gte = startDate;
      }
      if (endDate) {
        dateFilter.lte = endDate;
      }
      sessionWhere.sesiones = { fecha_inicio_utc: dateFilter };
    }

    const sessionAssignments = (await prisma.sesion_trainers.findMany({
      where: sessionWhere,
      select: {
        sesion_id: true,
        trainer_id: true,
        sesiones: {
          select: {
            id: true,
            deal_id: true,
            nombre_cache: true,
            fecha_inicio_utc: true,
            fecha_fin_utc: true,
            tiempo_parada: true,
            direccion: true,
            deal_products: { select: { name: true } },
            deals: { select: { title: true, pipeline_label: true, pipeline_id: true } },
          },
        },
      },
    })) as SessionAssignmentRow[];

    const variantAssignments = await fetchVariantAssignments(prisma, startDate, endDate);
    const variantIds = Array.from(variantAssignments.keys());

    const trainerIds = new Set<string>();
    for (const row of sessionAssignments) {
      const trainerId = normalizeIdentifier(row.trainer_id);
      if (trainerId) {
        trainerIds.add(trainerId);
      }
    }
    for (const [, trainerSet] of variantAssignments) {
      for (const trainerId of trainerSet) {
        trainerIds.add(trainerId);
      }
    }

    const trainerRecords = trainerIds.size
      ? ((await prisma.trainers.findMany({
          where: { trainer_id: { in: Array.from(trainerIds) } },
          select: { trainer_id: true, name: true, apellido: true, user_id: true },
        })) as TrainerSummary[])
      : [];
    const trainerMap = new Map<string, TrainerSummary>();
    for (const trainer of trainerRecords) {
      trainerMap.set(trainer.trainer_id, trainer);
    }

    const sessionIds = Array.from(
      new Set(sessionAssignments.map((row) => normalizeIdentifier(row.sesion_id)).filter(Boolean) as string[]),
    );

    const trainerExpenseDocumentsRaw = sessionIds.length
      ? await prisma.sesion_files.findMany({
          where: {
            sesion_id: { in: sessionIds },
            trainer_expense: true,
          },
          select: {
            id: true,
            sesion_id: true,
            trainer_expense_trainer_id: true,
            drive_file_name: true,
            drive_web_view_link: true,
            added_at: true,
          },
          orderBy: { added_at: 'desc' },
        })
      : [];

    const trainerExpenseDocuments = trainerExpenseDocumentsRaw
      .map(mapTrainerExpenseDocument)
      .filter((doc): doc is TrainerExpenseDocument => doc !== null);

    const trainerExpenseDocumentMap = new Map<string, TrainerExpenseDocument[]>();
    for (const doc of trainerExpenseDocuments) {
      if (!trainerExpenseDocumentMap.has(doc.sessionId)) {
        trainerExpenseDocumentMap.set(doc.sessionId, []);
      }
      trainerExpenseDocumentMap.get(doc.sessionId)!.push(doc);
    }

    const variantDetails = variantIds.length
      ? ((await prisma.variants.findMany({
          where: { id: { in: variantIds } },
          select: {
            id: true,
            name: true,
            date: true,
            sede: true,
            products: { select: { name: true } },
          },
        })) as VariantInfo[])
      : [];
    const variantDetailMap = new Map<string, VariantInfo>();
    for (const variant of variantDetails) {
      variantDetailMap.set(variant.id, variant);
    }

    const costFilters: Record<string, unknown> = {
      trainer_id: trainerIds.size ? { in: Array.from(trainerIds) } : undefined,
    };
    const costConditions: Array<Record<string, unknown>> = [];
    if (sessionIds.length) {
      costConditions.push({ session_id: { in: sessionIds } });
    }
    if (variantIds.length) {
      costConditions.push({ variant_id: { in: variantIds } });
    }

    let costRecords: ExtraCostRecord[] = [];
    if (costConditions.length) {
      costFilters.OR = costConditions;
      costRecords = (await prisma.trainer_extra_costs.findMany({
        where: costFilters,
      })) as unknown as ExtraCostRecord[];
    }

    const costMap = new Map<string, ExtraCostRecord>();
    for (const record of costRecords) {
      const trainerId = normalizeIdentifier(record.trainer_id);
      if (record.session_id && trainerId) {
        const key = buildCostKey('session', record.session_id, trainerId);
        costMap.set(key, record);
        continue;
      }
      if (record.variant_id && trainerId) {
        const key = buildCostKey('variant', record.variant_id, trainerId);
        costMap.set(key, record);
      }
    }

    const items: TrainerExtraCostResponseItem[] = [];

    for (const row of sessionAssignments) {
      const sessionId = normalizeIdentifier(row.sesion_id);
      const trainerId = normalizeIdentifier(row.trainer_id);
      if (!sessionId || !trainerId) {
        continue;
      }
      const key = buildCostKey('session', sessionId, trainerId);
      const record = costMap.get(key) ?? null;
      const trainer = trainerMap.get(trainerId) ?? null;
      items.push(
        mapResponseItem({
          key,
          record,
          trainer,
          assignmentType: 'session',
          sessionInfo: row.sesiones,
          expenseDocuments: filterTrainerExpenseDocuments(
            trainerExpenseDocumentMap.get(sessionId) ?? [],
            trainerId,
          ),
        }),
      );
    }

    for (const [variantId, trainerSet] of variantAssignments.entries()) {
      const variantInfo = variantDetailMap.get(variantId) ?? null;
      for (const trainerId of trainerSet) {
        const key = buildCostKey('variant', variantId, trainerId);
        const record = costMap.get(key) ?? null;
        const trainer = trainerMap.get(trainerId) ?? null;
        items.push(
          mapResponseItem({
            key,
            record,
            trainer,
            assignmentType: 'variant',
            variantInfo,
          }),
        );
      }
    }

    items.sort((a, b) => {
      const aDate = a.scheduledStart ? new Date(a.scheduledStart).getTime() : 0;
      const bDate = b.scheduledStart ? new Date(b.scheduledStart).getTime() : 0;
      if (Number.isFinite(aDate) && Number.isFinite(bDate) && aDate !== bDate) {
        return bDate - aDate;
      }
      const aName = `${a.trainerName ?? ''} ${a.trainerLastName ?? ''}`.trim();
      const bName = `${b.trainerName ?? ''} ${b.trainerLastName ?? ''}`.trim();
      return aName.localeCompare(bName, 'es', { sensitivity: 'base' });
    });

    const response: TrainerExtraCostResponse = { items };
    return successResponse(response);
  }

  const body = request.body;
  if (!body || typeof body !== 'object') {
    return errorResponse('INVALID_BODY', 'Se requiere un cuerpo JSON.', 400);
  }

  const payload = body as TrainerExtraCostSavePayload;
  const trainerId = normalizeIdentifier(payload.trainerId);
  const sessionId = normalizeIdentifier(payload.sessionId ?? payload.sesionId);
  const variantId = normalizeIdentifier(payload.variantId);

  if (!trainerId) {
    return errorResponse('VALIDATION_ERROR', 'trainerId es obligatorio.', 400);
  }

  const hasSession = Boolean(sessionId);
  const hasVariant = Boolean(variantId);

  if ((hasSession ? 1 : 0) + (hasVariant ? 1 : 0) !== 1) {
    return errorResponse('VALIDATION_ERROR', 'Debe enviarse sessionId o variantId.', 400);
  }

  const trainer = await prisma.trainers.findUnique({
    where: { trainer_id: trainerId },
    select: {
      trainer_id: true,
      name: true,
      apellido: true,
      contrato_fijo: true,
      user_id: true,
    },
  });

  if (!trainer) {
    return errorResponse('NOT_FOUND', 'No se encontró el formador indicado.', 404);
  }

  let sessionInfo: SessionInfo | null = null;
  let variantInfo: VariantInfo | null = null;

  if (hasSession) {
    const assignment = await prisma.sesion_trainers.findFirst({
      where: { sesion_id: sessionId!, trainer_id: trainerId },
      select: {
        sesiones: {
          select: {
            id: true,
            deal_id: true,
            nombre_cache: true,
            fecha_inicio_utc: true,
            fecha_fin_utc: true,
            direccion: true,
            deal_products: { select: { name: true } },
            deals: { select: { title: true, pipeline_label: true, pipeline_id: true } },
          },
        },
      },
    });

    if (!assignment || !assignment.sesiones) {
      return errorResponse(
        'NOT_FOUND',
        'No se encontró la sesión indicada para el formador proporcionado.',
        404,
      );
    }
    sessionInfo = assignment.sesiones;
  } else {
    const variant = await prisma.variants.findUnique({
      where: { id: variantId! },
      select: {
        id: true,
        name: true,
        date: true,
        sede: true,
        trainer_id: true,
        products: { select: { name: true } },
      },
    });

    if (!variant) {
      return errorResponse('NOT_FOUND', 'No se encontró la variante indicada.', 404);
    }

    const assigned =
      variant.trainer_id === trainerId || (await ensureTrainerAssignedToVariant(prisma, trainerId, variantId!));
    if (!assigned) {
      return errorResponse(
        'FORBIDDEN',
        'El formador indicado no está asignado a esta variante.',
        403,
      );
    }

    variantInfo = variant as VariantInfo;
  }

  const costsSource =
    payload.costs && typeof payload.costs === 'object' && payload.costs !== null
      ? (payload.costs as Record<string, unknown>)
      : (payload as Record<string, unknown>);

  const parsedCosts = parseCostValues(costsSource);
  if ('error' in parsedCosts) {
    return parsedCosts.error;
  }

  const parsedNotes = parseNotes(costsSource);
  if ('error' in parsedNotes) {
    return parsedNotes.error;
  }

  const updateData = buildCostUpdateData(parsedCosts.values);
  if (parsedNotes.provided) {
    updateData.notas = parsedNotes.value;
  }

  const createData = buildCostCreateData(
    trainerId,
    hasSession ? sessionId! : null,
    hasVariant ? variantId! : null,
    parsedCosts.values,
    parsedNotes.value,
  );

  const existingCost = await prisma.trainer_extra_costs.findUnique({
    where: hasSession
      ? { trainer_id_session_id: { trainer_id: trainerId, session_id: sessionId! } }
      : { trainer_id_variant_id: { trainer_id: trainerId, variant_id: variantId! } },
  });

  const upsertResult = await prisma.trainer_extra_costs.upsert({
    where: hasSession
      ? { trainer_id_session_id: { trainer_id: trainerId, session_id: sessionId! } }
      : { trainer_id_variant_id: { trainer_id: trainerId, variant_id: variantId! } },
    update: updateData,
    create: createData,
  });

  const responseItem = mapResponseItem({
    key: buildCostKey(hasSession ? 'session' : 'variant', hasSession ? sessionId! : variantId!, trainerId),
    record: upsertResult as unknown as ExtraCostRecord,
    trainer,
    assignmentType: hasSession ? 'session' : 'variant',
    sessionInfo: sessionInfo ?? undefined,
    variantInfo: variantInfo ?? undefined,
  });

  const periodDate = hasSession
    ? sessionInfo?.fecha_inicio_utc ?? null
    : variantInfo?.date ?? null;
  const payrollDelta = buildPayrollDelta(existingCost as ExtraCostRecord | null, upsertResult as ExtraCostRecord);
  await applyPayrollDelta(prisma, trainer, periodDate ?? null, payrollDelta);

  return successResponse({ item: responseItem });
});
