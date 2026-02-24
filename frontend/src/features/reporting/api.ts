import { delJson, getJson, postJson, putJson } from '../../api/client';

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

function sanitizeInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
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

export async function fetchTrainerHours(
  filters: TrainerHoursFilters = {}
): Promise<TrainerHoursResponse> {
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

export type TrainerSelfHoursItem = {
  id: string;
  sessionName: string | null;
  sessionDate: string | null;
  totalHours: number;
  serviceCost: number;
  extraCost: number;
  payrollCost: number;
  hasTimeLog: boolean;
  timeLogId: string | null;
  checkIn: string | null;
  checkOut: string | null;
};

export type TrainerSelfHoursResponse = {
  trainer: {
    id: string;
    name: string | null;
    lastName: string | null;
  };
  items: TrainerSelfHoursItem[];
  summary: {
    totalSessions: number;
    totalHours: number;
    totalServiceCost: number;
    totalExtraCost: number;
    totalPayrollCost: number;
  };
};

export async function fetchTrainerSelfHours(
  filters: TrainerHoursFilters = {}
): Promise<TrainerSelfHoursResponse> {
  const params = new URLSearchParams();
  if (filters.startDate) {
    params.set('startDate', filters.startDate);
  }
  if (filters.endDate) {
    params.set('endDate', filters.endDate);
  }

  const query = params.toString();
  const url = query.length ? `/trainer-control-horas?${query}` : '/trainer-control-horas';
  return getJson<TrainerSelfHoursResponse>(url);
}

export type ReportingTrainerControlHoursItem = {
  trainerId: string;
  trainerName: string;
  sessionId: string;
  sessionName: string;
  sessionDate: string | null;
  assignedHours: number;
  loggedHours: number;
  dayHours: number;
  nightHours: number;
  regionalHolidayHours: number;
  nationalHolidayHours: number;
  hasTimeLog: boolean;
  timeLogId: string | null;
  checkIn: string | null;
  checkOut: string | null;
};

export type ReportingTrainerControlHoursResponse = {
  items: ReportingTrainerControlHoursItem[];
};

function sanitizeReportingTrainerControlHoursItem(
  entry: unknown
): ReportingTrainerControlHoursItem | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const raw = entry as Record<string, unknown>;
  const trainerId = sanitizeText(raw.trainerId);
  const trainerName = sanitizeText(raw.trainerName);
  const sessionId = sanitizeText(raw.sessionId);
  const sessionName = sanitizeText(raw.sessionName);

  if (!trainerId || !trainerName || !sessionId || !sessionName) {
    return null;
  }

  return {
    trainerId,
    trainerName,
    sessionId,
    sessionName,
    sessionDate: sanitizeDate(raw.sessionDate),
    assignedHours: sanitizeNumber(raw.assignedHours),
    loggedHours: sanitizeNumber(raw.loggedHours),
    dayHours: sanitizeNumber(raw.dayHours),
    nightHours: sanitizeNumber(raw.nightHours),
    regionalHolidayHours: sanitizeNumber(raw.regionalHolidayHours),
    nationalHolidayHours: sanitizeNumber(raw.nationalHolidayHours),
    hasTimeLog: Boolean(raw.hasTimeLog),
    timeLogId: sanitizeText(raw.timeLogId),
    checkIn: sanitizeDate(raw.checkIn),
    checkOut: sanitizeDate(raw.checkOut)
  };
}

export async function fetchReportingTrainerControlHours(
  filters: TrainerHoursFilters = {}
): Promise<ReportingTrainerControlHoursResponse> {
  const params = new URLSearchParams();
  if (filters.startDate) {
    params.set('startDate', filters.startDate);
  }
  if (filters.endDate) {
    params.set('endDate', filters.endDate);
  }

  const query = params.toString();
  const url = query.length
    ? `/reporting-control-horas-formadores?${query}`
    : '/reporting-control-horas-formadores';
  const data = await getJson<{ items?: unknown }>(url);
  const items = Array.isArray(data?.items)
    ? data.items
        .map(sanitizeReportingTrainerControlHoursItem)
        .filter((item): item is ReportingTrainerControlHoursItem => item !== null)
    : [];

  return { items };
}

export type ReportingTrainerControlHoursUpsertPayload = {
  trainerId: string;
  sessionId: string;
  date: string;
  checkInTime: string;
  checkOutTime?: string | null;
};

export async function createReportingTrainerControlHoursEntry(
  payload: ReportingTrainerControlHoursUpsertPayload
): Promise<void> {
  await postJson(`/reporting-control-horas-formadores`, payload);
}

export async function updateReportingTrainerControlHoursEntry(
  payload: ReportingTrainerControlHoursUpsertPayload
): Promise<void> {
  await putJson(`/reporting-control-horas-formadores`, payload, {
    method: 'PUT'
  });
}

export async function deleteReportingTrainerControlHoursEntry(id: string): Promise<void> {
  await delJson(
    `/reporting-control-horas-formadores`,
    { id },
    {
      method: 'DELETE'
    }
  );
}

export type ReportingControlHorarioPerson = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  isFixedTrainer: boolean;
};

export type ReportingControlHorarioEntry = {
  id: string;
  userId: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  holidayType: 'A' | 'N' | null;
};

export type ReportingControlHorarioResponse = {
  range: {
    start: string;
    end: string;
  };
  people: ReportingControlHorarioPerson[];
  entries: ReportingControlHorarioEntry[];
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

function sanitizeReportingPerson(entry: unknown): ReportingControlHorarioPerson | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const raw = entry as Record<string, unknown>;
  const id = sanitizeText(raw.id);
  const name = sanitizeText(raw.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    email: sanitizeText(raw.email),
    role: sanitizeText(raw.role) ?? 'Desconocido',
    isFixedTrainer: Boolean(raw.isFixedTrainer ?? raw.is_fixed_trainer)
  };
}

function sanitizeReportingEntry(entry: unknown): ReportingControlHorarioEntry | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const raw = entry as Record<string, unknown>;
  const id = sanitizeText(raw.id);
  const userId = sanitizeText(raw.userId ?? raw.user_id);
  const date = sanitizeText(raw.date);
  if (!id || !userId || !date) {
    return null;
  }
  return {
    id,
    userId,
    date,
    checkIn: sanitizeDate(raw.checkIn ?? raw.check_in),
    checkOut: sanitizeDate(raw.checkOut ?? raw.check_out),
    holidayType:
      raw.holidayType === 'N' || raw.holiday_type === 'N'
        ? 'N'
        : raw.holidayType === 'A' || raw.holiday_type === 'A'
          ? 'A'
          : null
  };
}

export type ReportingControlHorarioFilters = {
  startDate?: string;
  endDate?: string;
};

export async function fetchReportingControlHorario(
  filters: ReportingControlHorarioFilters = {}
): Promise<ReportingControlHorarioResponse> {
  const params = new URLSearchParams();
  if (filters.startDate) {
    params.set('startDate', filters.startDate);
  }
  if (filters.endDate) {
    params.set('endDate', filters.endDate);
  }
  const query = params.toString();
  const url = query.length ? `/reporting-control-horario?${query}` : '/reporting-control-horario';
  const data = await getJson<{ range?: unknown; people?: unknown; entries?: unknown }>(url);
  const people = Array.isArray(data?.people)
    ? data.people
        .map(sanitizeReportingPerson)
        .filter((item): item is ReportingControlHorarioPerson => item !== null)
    : [];
  const entries = Array.isArray(data?.entries)
    ? data.entries
        .map(sanitizeReportingEntry)
        .filter((item): item is ReportingControlHorarioEntry => item !== null)
    : [];
  const range = (data?.range ?? {}) as { start?: string; end?: string };
  return {
    range: {
      start: sanitizeText(range.start) ?? '',
      end: sanitizeText(range.end) ?? ''
    },
    people,
    entries
  };
}

export type ReportingControlHorarioUpsertPayload = {
  id?: string;
  userId?: string;
  date?: string;
  checkInTime: string;
  checkOutTime?: string | null;
};

export async function createReportingControlHorarioEntry(
  payload: ReportingControlHorarioUpsertPayload
): Promise<ReportingControlHorarioEntry> {
  const data = await postJson<{ entry?: unknown }>(`/reporting-control-horario`, payload);
  const entry = sanitizeReportingEntry(data?.entry);
  if (!entry) {
    throw new Error('Respuesta inválida del servidor.');
  }
  return entry;
}

export async function updateReportingControlHorarioEntry(
  payload: ReportingControlHorarioUpsertPayload
): Promise<ReportingControlHorarioEntry> {
  const data = await putJson<{ entry?: unknown }>(`/reporting-control-horario`, payload, {
    method: 'PUT'
  });
  const entry = sanitizeReportingEntry(data?.entry);
  if (!entry) {
    throw new Error('Respuesta inválida del servidor.');
  }
  return entry;
}

export async function deleteReportingControlHorarioEntry(id: string): Promise<void> {
  await delJson(
    `/reporting-control-horario`,
    { id },
    {
      method: 'DELETE'
    }
  );
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
    after: raw.after ?? null
  } satisfies AuditLogEntry;
}

export type FetchAuditLogsOptions = {
  limit?: number;
};

export async function fetchAuditLogs(
  options: FetchAuditLogsOptions = {}
): Promise<AuditLogEntry[]> {
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

export type PipedriveWebhookEvent = {
  id: string;
  createdAt: string | null;
  event: string | null;
  eventAction: string | null;
  eventObject: string | null;
  companyId: number | null;
  objectId: number | null;
  retry: number | null;
  webhookToken: string | null;
  headers: Record<string, unknown> | null;
  payload: unknown;
};

function sanitizeRecord(record: unknown): PipedriveWebhookEvent | null {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const raw = record as Record<string, unknown>;
  const id = sanitizeText(raw.id);
  if (!id) {
    return null;
  }

  return {
    id,
    createdAt: sanitizeDate(raw.createdAt ?? raw.created_at),
    event: sanitizeText(raw.event),
    eventAction: sanitizeText(raw.eventAction ?? raw.event_action),
    eventObject: sanitizeText(raw.eventObject ?? raw.event_object),
    companyId: sanitizeInteger(raw.companyId ?? raw.company_id),
    objectId: sanitizeInteger(raw.objectId ?? raw.object_id),
    retry: sanitizeInteger(raw.retry),
    webhookToken: sanitizeText(raw.webhookToken ?? raw.webhook_token),
    headers:
      typeof raw.headers === 'object' && raw.headers !== null
        ? (raw.headers as Record<string, unknown>)
        : null,
    payload: raw.payload ?? null
  } satisfies PipedriveWebhookEvent;
}

export type FetchPipedriveWebhookEventsOptions = {
  limit?: number;
};

export async function fetchPipedriveWebhookEvents(
  options: FetchPipedriveWebhookEventsOptions = {}
): Promise<PipedriveWebhookEvent[]> {
  const params = new URLSearchParams();
  const limit = options.limit;
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    params.set('limit', String(Math.min(Math.trunc(limit), 500)));
  }

  const query = params.toString();
  const url = query.length
    ? `/reporting-pipedrive-webhooks?${query}`
    : '/reporting-pipedrive-webhooks';

  const data = await getJson<{ events?: unknown }>(url);
  const events = Array.isArray(data?.events) ? data.events : [];
  return events
    .map(sanitizeRecord)
    .filter((record): record is PipedriveWebhookEvent => record !== null);
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
  'gastosExtras'
] as const;

export type TrainerExtraCostFieldKey = (typeof EXTRA_COST_FIELD_KEYS)[number];

export const DEFAULT_TRAINER_EXTRA_COST_VALUES: Partial<Record<TrainerExtraCostFieldKey, number>> =
  {
    precioCosteFormacion: 15,
    precioCostePreventivo: 15
  };

export type TrainerExpenseDocument = {
  id: string;
  sessionId: string;
  trainerId: string | null;
  name: string | null;
  url: string | null;
  addedAt: string | null;
};

export type TrainerExtraCostRecord = {
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
  costs: Record<TrainerExtraCostFieldKey, number>;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  trainerExpenseDocuments: TrainerExpenseDocument[];
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

function sanitizeTrainerExpenseDocument(entry: unknown): TrainerExpenseDocument | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const raw = entry as Record<string, unknown>;
  const id = sanitizeText(raw.id);
  const sessionId =
    sanitizeText(raw.sessionId ?? raw.session_id ?? raw.sesionId ?? raw.sesion_id) ?? null;
  const trainerId =
    sanitizeText(raw.trainerId ?? raw.trainer_id ?? raw.trainerExpenseTrainerId) ?? null;

  if (!id || !sessionId) {
    return null;
  }

  return {
    id,
    sessionId,
    trainerId,
    name:
      sanitizeText(raw.name ?? raw.fileName ?? raw.drive_file_name ?? raw.driveFileName) ?? null,
    url: sanitizeText(raw.url ?? raw.drive_web_view_link ?? raw.webUrl) ?? null,
    addedAt: sanitizeDate(raw.addedAt ?? raw.added_at)
  } satisfies TrainerExpenseDocument;
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
    const value =
      costsInput && typeof costsInput === 'object'
        ? (costsInput as Record<string, unknown>)[field]
        : undefined;
    if (value === undefined) {
      costs[field] = DEFAULT_TRAINER_EXTRA_COST_VALUES[field] ?? 0;
      continue;
    }
    costs[field] = sanitizeNumber(value);
  }

  const trainerExpenseDocumentsInput = Array.isArray(raw.trainerExpenseDocuments)
    ? raw.trainerExpenseDocuments
    : [];
  const trainerExpenseDocuments = trainerExpenseDocumentsInput
    .map(sanitizeTrainerExpenseDocument)
    .filter((doc): doc is TrainerExpenseDocument => doc !== null);

  const record: TrainerExtraCostRecord = {
    key,
    recordId: sanitizeText(raw.recordId ?? raw.record_id),
    trainerId,
    trainerName: sanitizeText(raw.trainerName ?? raw.trainer_name),
    trainerLastName: sanitizeText(raw.trainerLastName ?? raw.trainer_last_name),
    trainerUserId: sanitizeText(raw.trainerUserId ?? raw.trainer_user_id),
    assignmentType,
    sessionId: sanitizeText(raw.sessionId ?? raw.session_id),
    variantId: sanitizeText(raw.variantId ?? raw.variant_id),
    sessionName: sanitizeText(raw.sessionName ?? raw.session_name),
    variantName: sanitizeText(raw.variantName ?? raw.variant_name),
    dealTitle: sanitizeText(raw.dealTitle ?? raw.deal_title),
    pipelineLabel: sanitizeText(raw.pipelineLabel ?? raw.pipeline_label),
    productName: sanitizeText(raw.productName ?? raw.product_name),
    site: sanitizeText(raw.site),
    scheduledStart: sanitizeDate(raw.scheduledStart ?? raw.scheduled_start),
    scheduledEnd: sanitizeDate(raw.scheduledEnd ?? raw.scheduled_end),
    workedHours:
      typeof raw.workedHours === 'number' && Number.isFinite(raw.workedHours)
        ? raw.workedHours
        : null,
    costs,
    notes: sanitizeText(raw.notes) ?? null,
    createdAt: sanitizeDate(raw.createdAt ?? raw.created_at),
    updatedAt: sanitizeDate(raw.updatedAt ?? raw.updated_at),
    trainerExpenseDocuments
  };

  return record;
}

export async function fetchTrainerExtraCosts(
  filters: TrainerExtraCostFilters = {}
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
  payload: TrainerExtraCostSavePayload
): Promise<TrainerExtraCostRecord> {
  const response = await putJson<{ item?: unknown }>('/reporting-costes-extra', payload);
  const sanitized = sanitizeExtraCostItem(response?.item);
  if (!sanitized) {
    throw new Error('Respuesta inválida al guardar el coste extra.');
  }
  return sanitized;
}

export type ComparativaPeriod = {
  startDate: string;
  endDate: string;
};

export type ComparativaFilters = {
  currentPeriod: ComparativaPeriod;
  previousPeriod: ComparativaPeriod;
  granularity: 'day' | 'isoWeek' | 'month';
  siteIds?: string[];
  trainingTypes?: string[];
  comerciales?: string[];
  serviceType?: string;
};

export type ComparativaKpi = {
  key: string;
  label: string;
  unit?: 'number' | 'percentage' | 'currency' | 'hours';
  value: number;
  lastYearValue: number;
  deltaPercentage: number;
  sparkline: number[];
};

export type ComparativaTrendPoint = {
  periodLabel: string;
  isoYear: number;
  isoWeek: number;
  currentValue: number;
  previousValue: number;
};

export type ComparativaTrend = {
  metric:
    | 'sessions'
    | 'revenue'
    | 'enrollments'
    | 'formacionEmpresaSessions'
    | 'gepServicesSessions';
  label: string;
  points: ComparativaTrendPoint[];
};

export type ComparativaBreakdown = {
  dimension:
    | 'site'
    | 'service'
    | 'channel'
    | 'formacionEmpresaSite'
    | 'formacionAbiertaSite'
    | 'gepServicesType';
  label: string;
  current: number;
  previous: number;
};

export type ComparativaDonutSlice = {
  label: string;
  percentage: number;
};

export type ComparativaBinaryMix = {
  key:
    | 'formacionEmpresaFundae'
    | 'formacionEmpresaCaes'
    | 'formacionEmpresaHotel'
    | 'gepServicesCaes';
  label: string;
  yes: number;
  no: number;
};

export type ComparativaHeatmapCell = {
  site: string;
  isoWeek: number;
  isoYear: number;
  utilization: number;
};

export type ComparativaFunnelStage = {
  name: string;
  current: number;
  previous: number;
  conversionRate: number;
};

export type ComparativaRankingRow = {
  rank: number;
  label: string;
  category: string;
  currentValue: number;
  previousValue: number;
  conversionRate?: number;
};

export type ComparativaSessionDetail = {
  date: string;
  sessionName: string;
  organizationName: string;
  site: string;
  trainers: string[];
};

export type ComparativaMetricSessionGroup = {
  key: string;
  label: string;
  sessions: ComparativaSessionDetail[];
};

export type ComparativaSessionGroup = {
  key: string;
  label: string;
  sessions: ComparativaSessionDetail[];
};

export type ComparativaMobileUnitUsage = {
  key: string;
  label: string;
  currentValue: number;
};

export type ComparativaDashboardResponse = {
  highlights: ComparativaKpi[];
  trends: ComparativaTrend[];
  breakdowns: ComparativaBreakdown[];
  revenueMix: ComparativaDonutSlice[];
  binaryMixes: ComparativaBinaryMix[];
  heatmap: ComparativaHeatmapCell[];
  funnel: ComparativaFunnelStage[];
  ranking: ComparativaRankingRow[];
  metricSessions: ComparativaMetricSessionGroup[];
  listingSessions: ComparativaSessionGroup[];
  mobileUnitsUsage: ComparativaMobileUnitUsage[];
  filterOptions: {
    sites: string[];
    trainingTypes: string[];
    comerciales: string[];
  };
};

export async function fetchComparativaDashboard(
  filters: ComparativaFilters
): Promise<ComparativaDashboardResponse> {
  const params = new URLSearchParams();

  params.set('currentStartDate', filters.currentPeriod.startDate);
  params.set('currentEndDate', filters.currentPeriod.endDate);
  params.set('previousStartDate', filters.previousPeriod.startDate);
  params.set('previousEndDate', filters.previousPeriod.endDate);
  params.set('granularity', filters.granularity);

  filters.siteIds?.forEach((siteId) => params.append('siteId', siteId));
  filters.trainingTypes?.forEach((trainingType) => params.append('trainingType', trainingType));
  filters.comerciales?.forEach((comercial) => params.append('comercial', comercial));
  if (filters.serviceType) params.set('serviceType', filters.serviceType);

  const query = params.toString();
  const url = query.length
    ? `/reporting-comparativa/dashboard?${query}`
    : '/reporting-comparativa/dashboard';

  return getJson<ComparativaDashboardResponse>(url);
}

export type OfficePayrollRecord = {
  id: string | null;
  userId: string;
  fullName: string;
  email: string | null;
  role: string | null;
  trainerFixedContract?: boolean | null;
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

export type OfficePayrollResponse = {
  entries: OfficePayrollRecord[];
  availableYears: number[];
  latestMonth: { year: number; month: number } | null;
};

export async function fetchOfficePayrolls(year?: number | null): Promise<OfficePayrollResponse> {
  const params = new URLSearchParams();
  if (typeof year === 'number' && Number.isFinite(year)) {
    params.set('year', String(year));
  }

  const query = params.toString();
  const url = query.length ? `/reporting-nominas-oficina?${query}` : '/reporting-nominas-oficina';
  const response = await getJson<OfficePayrollResponse>(url);
  if (!response || !Array.isArray(response.entries)) {
    throw new Error('Respuesta inválida al cargar las nóminas de oficina');
  }
  return {
    entries: response.entries,
    availableYears: Array.isArray(response.availableYears) ? response.availableYears : [],
    latestMonth: response.latestMonth ?? null
  };
}

export type OfficePayrollUpsertPayload = {
  userId: string;
  year: number;
  month: number;
  convenio?: string | null;
  categoria?: string | null;
  dietas?: number | string | null;
  kilometrajes?: number | string | null;
  pernocta?: number | string | null;
  nocturnidad?: number | string | null;
  festivo?: number | string | null;
  horasExtras?: number | string | null;
  otrosGastos?: number | string | null;
  totalExtras?: number | string | null;
  antiguedad?: string | null;
  horasSemana?: number | string | null;
  baseRetencion?: number | string | null;
  baseRetencionDetalle?: string | null;
  salarioBruto?: number | string | null;
  salarioBrutoTotal?: number | string | null;
  retencion?: number | string | null;
  aportacionSsIrpf?: number | string | null;
  aportacionSsIrpfDetalle?: string | null;
  salarioLimpio?: number | string | null;
  contingenciasComunes?: number | string | null;
  contingenciasComunesDetalle?: string | null;
  totalEmpresa?: number | string | null;
};

export async function saveOfficePayroll(
  payload: OfficePayrollUpsertPayload
): Promise<OfficePayrollRecord> {
  const response = await putJson<{ entry?: OfficePayrollRecord }>(
    '/reporting-nominas-oficina',
    payload
  );
  if (response?.entry) {
    return response.entry;
  }
  throw new Error('No se pudo guardar la nómina de oficina');
}


export type SlackDailyAvailabilityResponse = {
  message: string;
  date: string;
  nextDate: string;
  channel: string;
  text: string;
  availability: Record<string, { off: string[]; telework: string[] }>;
};

export async function sendDailyAvailabilitySlackMessage(): Promise<SlackDailyAvailabilityResponse> {
  return postJson<SlackDailyAvailabilityResponse>('/daily-availability-slack', {});
}
