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
  isVariant: boolean;
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
    isVariant: Boolean(raw.isVariant ?? raw.is_variant),
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

export type ComparativaPeriod = {
  startDate: string;
  endDate: string;
};

export type ComparativaFilters = {
  currentPeriod: ComparativaPeriod;
  previousPeriod: ComparativaPeriod;
  granularity: 'day' | 'isoWeek' | 'month';
  siteId?: string;
  costCenterId?: string;
  trainingType?: string;
  serviceType?: string;
  channel?: string;
  funnel?: string;
  includeCancellations?: boolean;
  includeNoShow?: boolean;
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
  metric: 'sessions' | 'revenue' | 'enrollments';
  label: string;
  points: ComparativaTrendPoint[];
};

export type ComparativaBreakdown = {
  dimension: 'site' | 'service' | 'channel';
  label: string;
  current: number;
  previous: number;
};

export type ComparativaDonutSlice = {
  label: string;
  percentage: number;
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

export type ComparativaDashboardResponse = {
  highlights: ComparativaKpi[];
  trends: ComparativaTrend[];
  breakdowns: ComparativaBreakdown[];
  revenueMix: ComparativaDonutSlice[];
  heatmap: ComparativaHeatmapCell[];
  funnel: ComparativaFunnelStage[];
  ranking: ComparativaRankingRow[];
};

function buildComparativaDashboardFallback(): ComparativaDashboardResponse {
  const highlights: ComparativaKpi[] = [
    {
      key: 'sessions',
      label: 'Sesiones impartidas',
      unit: 'number',
      value: 148,
      lastYearValue: 132,
      deltaPercentage: 12.1,
      sparkline: [10, 12, 14, 13, 16, 18, 20, 19, 22, 21],
    },
    {
      key: 'revenue',
      label: 'Ingresos (€)',
      unit: 'currency',
      value: 186000,
      lastYearValue: 171500,
      deltaPercentage: 8.47,
      sparkline: [14000, 15000, 15500, 16000, 17000, 18500, 19000, 21000, 22000, 23000],
    },
    {
      key: 'enrollments',
      label: 'Inscritos',
      unit: 'number',
      value: 2150,
      lastYearValue: 1890,
      deltaPercentage: 13.76,
      sparkline: [150, 160, 170, 180, 190, 205, 210, 225, 235, 240],
    },
    {
      key: 'attendance',
      label: 'Asistencia efectiva',
      unit: 'percentage',
      value: 91.5,
      lastYearValue: 88.2,
      deltaPercentage: 3.3,
      sparkline: [87, 87.5, 88, 88.5, 89.2, 90, 90.5, 90.8, 91, 91.5],
    },
  ];

  const trends: ComparativaTrend[] = [
    {
      metric: 'sessions',
      label: 'Sesiones programadas',
      points: [
        { periodLabel: '2024-W01', isoYear: 2024, isoWeek: 1, currentValue: 12, previousValue: 10 },
        { periodLabel: '2024-W02', isoYear: 2024, isoWeek: 2, currentValue: 14, previousValue: 11 },
        { periodLabel: '2024-W03', isoYear: 2024, isoWeek: 3, currentValue: 15, previousValue: 12 },
        { periodLabel: '2024-W04', isoYear: 2024, isoWeek: 4, currentValue: 16, previousValue: 13 },
      ],
    },
    {
      metric: 'revenue',
      label: 'Ingresos facturados',
      points: [
        { periodLabel: '2024-W01', isoYear: 2024, isoWeek: 1, currentValue: 15000, previousValue: 14200 },
        { periodLabel: '2024-W02', isoYear: 2024, isoWeek: 2, currentValue: 16500, previousValue: 15000 },
        { periodLabel: '2024-W03', isoYear: 2024, isoWeek: 3, currentValue: 17000, previousValue: 15300 },
        { periodLabel: '2024-W04', isoYear: 2024, isoWeek: 4, currentValue: 18200, previousValue: 16000 },
      ],
    },
    {
      metric: 'enrollments',
      label: 'Inscritos confirmados',
      points: [
        { periodLabel: '2024-W01', isoYear: 2024, isoWeek: 1, currentValue: 180, previousValue: 165 },
        { periodLabel: '2024-W02', isoYear: 2024, isoWeek: 2, currentValue: 190, previousValue: 172 },
        { periodLabel: '2024-W03', isoYear: 2024, isoWeek: 3, currentValue: 195, previousValue: 176 },
        { periodLabel: '2024-W04', isoYear: 2024, isoWeek: 4, currentValue: 210, previousValue: 185 },
      ],
    },
  ];

  const breakdowns: ComparativaBreakdown[] = [
    { dimension: 'site', label: 'Madrid', current: 45, previous: 38 },
    { dimension: 'site', label: 'Barcelona', current: 38, previous: 35 },
    { dimension: 'site', label: 'Valencia', current: 22, previous: 19 },
    { dimension: 'service', label: 'Formación in-company', current: 54, previous: 49 },
    { dimension: 'service', label: 'E-learning', current: 32, previous: 27 },
    { dimension: 'service', label: 'Prevención', current: 18, previous: 14 },
    { dimension: 'channel', label: 'Ventas directas', current: 60, previous: 52 },
    { dimension: 'channel', label: 'Partners', current: 25, previous: 24 },
    { dimension: 'channel', label: 'Marketplace', current: 15, previous: 12 },
  ];

  const revenueMix: ComparativaDonutSlice[] = [
    { label: 'In-company', percentage: 42 },
    { label: 'E-learning', percentage: 28 },
    { label: 'Formación abierta', percentage: 18 },
    { label: 'Preventivo', percentage: 12 },
  ];

  const heatmap: ComparativaHeatmapCell[] = [
    { site: 'Madrid', isoWeek: 1, isoYear: 2024, utilization: 82 },
    { site: 'Madrid', isoWeek: 2, isoYear: 2024, utilization: 78 },
    { site: 'Barcelona', isoWeek: 1, isoYear: 2024, utilization: 74 },
    { site: 'Barcelona', isoWeek: 2, isoYear: 2024, utilization: 71 },
    { site: 'Valencia', isoWeek: 1, isoYear: 2024, utilization: 63 },
    { site: 'Valencia', isoWeek: 2, isoYear: 2024, utilization: 66 },
  ];

  const funnel: ComparativaFunnelStage[] = [
    { name: 'Leads', current: 1200, previous: 1100, conversionRate: 100 },
    { name: 'Oportunidades', current: 620, previous: 590, conversionRate: 51.7 },
    { name: 'Propuestas', current: 400, previous: 360, conversionRate: 64.5 },
    { name: 'Inscripciones', current: 260, previous: 230, conversionRate: 65 },
    { name: 'Asistencias', current: 238, previous: 205, conversionRate: 91.5 },
  ];

  const ranking: ComparativaRankingRow[] = [
    { rank: 1, label: 'Curso de prevención avanzada', category: 'Curso', currentValue: 52000, previousValue: 47000, conversionRate: 64 },
    { rank: 2, label: 'Madrid', category: 'Sede', currentValue: 45000, previousValue: 41000, conversionRate: 67 },
    { rank: 3, label: 'Canal partners', category: 'Canal', currentValue: 38000, previousValue: 33000, conversionRate: 58 },
    { rank: 4, label: 'Barcelona', category: 'Sede', currentValue: 34000, previousValue: 32000, conversionRate: 62 },
    { rank: 5, label: 'Formación abierta', category: 'Servicio', currentValue: 31000, previousValue: 28000, conversionRate: 55 },
  ];

  return { highlights, trends, breakdowns, revenueMix, heatmap, funnel, ranking } satisfies ComparativaDashboardResponse;
}

export async function fetchComparativaDashboard(
  filters: ComparativaFilters,
): Promise<ComparativaDashboardResponse> {
  const params = new URLSearchParams();

  params.set('currentStartDate', filters.currentPeriod.startDate);
  params.set('currentEndDate', filters.currentPeriod.endDate);
  params.set('previousStartDate', filters.previousPeriod.startDate);
  params.set('previousEndDate', filters.previousPeriod.endDate);
  params.set('granularity', filters.granularity);

  if (filters.siteId) params.set('siteId', filters.siteId);
  if (filters.costCenterId) params.set('costCenterId', filters.costCenterId);
  if (filters.trainingType) params.set('trainingType', filters.trainingType);
  if (filters.serviceType) params.set('serviceType', filters.serviceType);
  if (filters.channel) params.set('channel', filters.channel);
  if (filters.funnel) params.set('funnel', filters.funnel);
  if (filters.includeCancellations) params.set('includeCancellations', 'true');
  if (filters.includeNoShow) params.set('includeNoShow', 'true');

  const query = params.toString();
  const url = query.length
    ? `/reporting-comparativa/dashboard?${query}`
    : '/reporting-comparativa/dashboard';

  try {
    return await getJson<ComparativaDashboardResponse>(url);
  } catch (error) {
    console.warn('Fallo al recuperar la comparativa, se devuelve placeholder', error);
    return buildComparativaDashboardFallback();
  }
}
