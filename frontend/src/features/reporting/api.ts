import { getJson, putJson } from '../../api/client';

function sanitizeText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function sanitizeDate(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.length) {
    return null;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return trimmed;
}

export type TrainerHoursItem = {
  trainerId: string;
  name: string | null;
  lastName: string | null;
  sessionCount: number;
  totalHours: number;
  serviceCost: number;
  extraCost: number;
  payrollCost: number;
};

export type TrainerHoursResponse = {
  items: TrainerHoursItem[];
  summary: {
    totalSessions: number;
    totalHours: number;
    totalServiceCost: number;
    totalExtraCost: number;
    totalPayrollCost: number;
  };
};

export type TrainerHoursFilters = {
  startDate?: string;
  endDate?: string;
};

export async function fetchTrainerHours(filters: TrainerHoursFilters = {}): Promise<TrainerHoursResponse> {
  const params = new URLSearchParams();
  if (filters.startDate) {
    params.set('startDate', filters.startDate);
  }
  if (filters.endDate) {
    params.set('endDate', filters.endDate);
  }

  const query = params.toString();
  const url = query.length ? `/reporting-horas-formadores?${query}` : '/reporting-horas-formadores';
  return getJson<TrainerHoursResponse>(url);
}

export type ControlHorarioRecord = {
  id: string;
  sessionName: string | null;
  organizationName: string | null;
  trainerFullName: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  clockIn: string | null;
  clockOut: string | null;
};

export type AuditLogEntry = {
  id: string;
  createdAt: string | null;
  action: string;
  entityType: string;
  entityId: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  before: unknown | null;
  after: unknown | null;
};

function sanitizeControlHorarioRecord(entry: unknown): ControlHorarioRecord | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const raw = entry as Record<string, unknown>;
  const id = sanitizeText(raw.id);
  const trainerFullName =
    sanitizeText(raw.trainerFullName ?? raw.trainer_full_name) ??
    sanitizeText(raw.trainerName ?? raw.trainer_name) ??
    sanitizeText(raw.trainerId ?? raw.trainer_id);

  if (!id || !trainerFullName) {
    return null;
  }

  return {
    id,
    sessionName: sanitizeText(raw.sessionName ?? raw.session_name),
    organizationName: sanitizeText(raw.organizationName ?? raw.organization_name),
    trainerFullName,
    plannedStart: sanitizeDate(raw.plannedStart ?? raw.planned_start),
    plannedEnd: sanitizeDate(raw.plannedEnd ?? raw.planned_end),
    clockIn: sanitizeDate(raw.clockIn ?? raw.clock_in),
    clockOut: sanitizeDate(raw.clockOut ?? raw.clock_out),
  } satisfies ControlHorarioRecord;
}

export async function fetchControlHorarioRecords(): Promise<ControlHorarioRecord[]> {
  const data = await getJson<{ records?: unknown }>(`/reporting-control-horario`);
  const entries = Array.isArray(data?.records) ? data.records : [];
  return entries
    .map(sanitizeControlHorarioRecord)
    .filter((record): record is ControlHorarioRecord => record !== null);
}

function sanitizeAuditLogEntry(entry: unknown): AuditLogEntry | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const raw = entry as Record<string, unknown>;
  const id = sanitizeText(raw.id);
  if (!id) {
    return null;
  }

  return {
    id,
    createdAt: sanitizeDate(raw.createdAt ?? raw.created_at),
    action: sanitizeText(raw.action) ?? '',
    entityType: sanitizeText(raw.entityType ?? raw.entity_type) ?? '',
    entityId: sanitizeText(raw.entityId ?? raw.entity_id) ?? '',
    userId: sanitizeText(raw.userId ?? raw.user_id),
    userName: sanitizeText(raw.userName ?? raw.user_name),
    userEmail: sanitizeText(raw.userEmail ?? raw.user_email),
    before: raw.before ?? null,
    after: raw.after ?? null,
  } satisfies AuditLogEntry;
}

export type FetchAuditLogsOptions = {
  limit?: number;
};

export async function fetchAuditLogs(options: FetchAuditLogsOptions = {}): Promise<AuditLogEntry[]> {
  const params = new URLSearchParams();
  const limit = options.limit;
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    const normalized = Math.min(Math.floor(limit), 500);
    params.set('limit', String(normalized));
  }

  const query = params.toString();
  const url = query.length ? `/reporting-logs?${query}` : '/reporting-logs';

  const data = await getJson<{ logs?: unknown }>(url);
  const entries = Array.isArray(data?.logs) ? data.logs : [];
  return entries
    .map(sanitizeAuditLogEntry)
    .filter((entry): entry is AuditLogEntry => entry !== null);
}

const EXTRA_COST_FIELD_KEYS = [
  'precioCosteFormacion',
  'precioCostePreventivo',
  'dietas',
  'kilometraje',
  'pernocta',
  'nocturnidad',
  'festivo',
  'horasExtras',
  'gastosExtras',
] as const;

export type TrainerExtraCostFieldKey = (typeof EXTRA_COST_FIELD_KEYS)[number];

export const DEFAULT_TRAINER_EXTRA_COST_VALUES: Partial<
  Record<TrainerExtraCostFieldKey, number>
> = {
  precioCosteFormacion: 15,
  precioCostePreventivo: 15,
};

export type TrainerExtraCostRecord = {
  key: string;
  recordId: string | null;
  trainerId: string;
  trainerName: string | null;
  trainerLastName: string | null;
  assignmentType: 'session' | 'variant';
  sessionId: string | null;
  variantId: string | null;
  sessionName: string | null;
  variantName: string | null;
  dealTitle: string | null;
  productName: string | null;
  site: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  costs: Record<TrainerExtraCostFieldKey, number>;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type TrainerExtraCostFilters = {
  startDate?: string;
  endDate?: string;
};

export type TrainerExtraCostSavePayload = {
  trainerId: string;
  sessionId?: string | null;
  variantId?: string | null;
  costs: Record<TrainerExtraCostFieldKey, number>;
  notes?: string | null;
};

function sanitizeNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.length) {
      return 0;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function sanitizeAssignmentType(value: unknown): 'session' | 'variant' | null {
  if (value === 'session' || value === 'variant') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'session' || normalized === 'variant') {
      return normalized;
    }
  }
  return null;
}

function sanitizeExtraCostItem(entry: unknown): TrainerExtraCostRecord | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const raw = entry as Record<string, unknown>;
  const key = sanitizeText(raw.key) ?? sanitizeText(raw.id);
  const trainerId = sanitizeText(raw.trainerId ?? raw.trainer_id);
  const assignmentType = sanitizeAssignmentType(raw.assignmentType ?? raw.assignment_type);

  if (!key || !trainerId || !assignmentType) {
    return null;
  }

  const costsInput = raw.costs;
  const costs: Record<TrainerExtraCostFieldKey, number> = {} as Record<
    TrainerExtraCostFieldKey,
    number
  >;
  for (const field of EXTRA_COST_FIELD_KEYS) {
    const value = costsInput && typeof costsInput === 'object'
      ? (costsInput as Record<string, unknown>)[field]
      : undefined;
    if (value === undefined) {
      costs[field] = DEFAULT_TRAINER_EXTRA_COST_VALUES[field] ?? 0;
      continue;
    }
    costs[field] = sanitizeNumber(value);
  }

  const record: TrainerExtraCostRecord = {
    key,
    recordId: sanitizeText(raw.recordId ?? raw.record_id),
    trainerId,
    trainerName: sanitizeText(raw.trainerName ?? raw.trainer_name),
    trainerLastName: sanitizeText(raw.trainerLastName ?? raw.trainer_last_name),
    assignmentType,
    sessionId: sanitizeText(raw.sessionId ?? raw.session_id),
    variantId: sanitizeText(raw.variantId ?? raw.variant_id),
    sessionName: sanitizeText(raw.sessionName ?? raw.session_name),
    variantName: sanitizeText(raw.variantName ?? raw.variant_name),
    dealTitle: sanitizeText(raw.dealTitle ?? raw.deal_title),
    productName: sanitizeText(raw.productName ?? raw.product_name),
    site: sanitizeText(raw.site),
    scheduledStart: sanitizeDate(raw.scheduledStart ?? raw.scheduled_start),
    scheduledEnd: sanitizeDate(raw.scheduledEnd ?? raw.scheduled_end),
    costs,
    notes: sanitizeText(raw.notes) ?? null,
    createdAt: sanitizeDate(raw.createdAt ?? raw.created_at),
    updatedAt: sanitizeDate(raw.updatedAt ?? raw.updated_at),
  };

  return record;
}

export async function fetchTrainerExtraCosts(
  filters: TrainerExtraCostFilters = {},
): Promise<TrainerExtraCostRecord[]> {
  const params = new URLSearchParams();
  if (filters.startDate) {
    params.set('startDate', filters.startDate);
  }
  if (filters.endDate) {
    params.set('endDate', filters.endDate);
  }

  const query = params.toString();
  const url = query.length ? `/reporting-costes-extra?${query}` : '/reporting-costes-extra';
  const data = await getJson<{ items?: unknown }>(url);
  const items = Array.isArray(data?.items) ? data.items : [];
  return items
    .map(sanitizeExtraCostItem)
    .filter((item): item is TrainerExtraCostRecord => item !== null);
}

export async function saveTrainerExtraCost(
  payload: TrainerExtraCostSavePayload,
): Promise<TrainerExtraCostRecord> {
  const response = await putJson<{ item?: unknown }>('/reporting-costes-extra', payload);
  const sanitized = sanitizeExtraCostItem(response?.item);
  if (!sanitized) {
    throw new Error('Respuesta inválida al guardar el coste extra.');
  }
  return sanitized;
}
