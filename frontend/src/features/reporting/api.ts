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
  preventiveHours: number;
  trainingHours: number;
  serviceCost: number;
  preventiveServiceCost: number;
  trainingServiceCost: number;
  extraCost: number;
  preventiveExtraCost: number;
  trainingExtraCost: number;
  payrollCost: number;
};

export type TrainerHoursResponse = {
  items: TrainerHoursItem[];
  summary: {
    totalSessions: number;
    totalHours: number;
    totalPreventiveHours: number;
    totalTrainingHours: number;
    totalServiceCost: number;
    totalPreventiveServiceCost: number;
    totalTrainingServiceCost: number;
    totalExtraCost: number;
    totalPreventiveExtraCost: number;
    totalTrainingExtraCost: number;
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
  weeklyContractHours: number | null;
};

export type ReportingControlHorarioEntry = {
  id: string;
  userId: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  holidayType: string | null;
};

export type ReportingControlHorarioAbsence = {
  userId: string;
  date: string;
  type: string;
};

export type ReportingControlHorarioResponse = {
  range: {
    start: string;
    end: string;
  };
  people: ReportingControlHorarioPerson[];
  entries: ReportingControlHorarioEntry[];
  absences: ReportingControlHorarioAbsence[];
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
    isFixedTrainer: Boolean(raw.isFixedTrainer ?? raw.is_fixed_trainer),
    weeklyContractHours:
      raw.weeklyContractHours === null || raw.weekly_contract_hours === null
        ? null
        : sanitizeOptionalNumber(raw.weeklyContractHours ?? raw.weekly_contract_hours),
  };
}


function sanitizeOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.length) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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
    holidayType: sanitizeText(raw.holidayType ?? raw.holiday_type)
  };
}

function sanitizeReportingAbsence(entry: unknown): ReportingControlHorarioAbsence | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const raw = entry as Record<string, unknown>;
  const userId = sanitizeText(raw.userId ?? raw.user_id);
  const date = sanitizeText(raw.date);
  const type = sanitizeText(raw.type);
  if (!userId || !date || !type) return null;
  return { userId, date, type };
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
  const data = await getJson<{ range?: unknown; people?: unknown; entries?: unknown; absences?: unknown }>(url);
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
  const absences = Array.isArray(data?.absences)
    ? data.absences
        .map(sanitizeReportingAbsence)
        .filter((item): item is ReportingControlHorarioAbsence => item !== null)
    : [];
  const range = (data?.range ?? {}) as { start?: string; end?: string };
  return {
    range: {
      start: sanitizeText(range.start) ?? '',
      end: sanitizeText(range.end) ?? ''
    },
    people,
    entries,
    absences,
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



export type LeadFormWebhookEvent = {
  id: string;
  createdAt: string | null;
  source: string | null;
  eventName: string | null;
  formName: string | null;
  entryId: string | null;
  leadName: string | null;
  leadEmail: string | null;
  leadPhone: string | null;
  leadMessage: string | null;
  requestHeaders: Record<string, unknown> | null;
  payload: unknown;
  pipedriveOrganizationId: string | null;
  pipedrivePersonId: string | null;
  pipedriveLeadId: string | null;
  pipedriveSyncedAt: string | null;
  slackNotifiedAt: string | null;
  lastSyncError: string | null;
};

function sanitizeLeadFormWebhookEvent(record: unknown): LeadFormWebhookEvent | null {
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
    source: sanitizeText(raw.source),
    eventName: sanitizeText(raw.eventName ?? raw.event_name),
    formName: sanitizeText(raw.formName ?? raw.form_name),
    entryId: sanitizeText(raw.entryId ?? raw.entry_id),
    leadName: sanitizeText(raw.leadName ?? raw.lead_name),
    leadEmail: sanitizeText(raw.leadEmail ?? raw.lead_email),
    leadPhone: sanitizeText(raw.leadPhone ?? raw.lead_phone),
    leadMessage: sanitizeText(raw.leadMessage ?? raw.lead_message),
    requestHeaders:
      typeof raw.requestHeaders === 'object' && raw.requestHeaders !== null
        ? (raw.requestHeaders as Record<string, unknown>)
        : typeof raw.request_headers === 'object' && raw.request_headers !== null
          ? (raw.request_headers as Record<string, unknown>)
          : null,
    payload: raw.payload ?? null,
    pipedriveOrganizationId: sanitizeText(raw.pipedriveOrganizationId ?? raw.pipedrive_organization_id),
    pipedrivePersonId: sanitizeText(raw.pipedrivePersonId ?? raw.pipedrive_person_id),
    pipedriveLeadId: sanitizeText(raw.pipedriveLeadId ?? raw.pipedrive_lead_id),
    pipedriveSyncedAt: sanitizeDate(raw.pipedriveSyncedAt ?? raw.pipedrive_synced_at),
    slackNotifiedAt: sanitizeDate(raw.slackNotifiedAt ?? raw.slack_notified_at),
    lastSyncError: sanitizeText(raw.lastSyncError ?? raw.last_sync_error),
  } satisfies LeadFormWebhookEvent;
}

export type FetchLeadFormWebhookEventsOptions = {
  limit?: number;
};

export async function fetchLeadFormWebhooks(
  options: FetchLeadFormWebhookEventsOptions = {}
): Promise<LeadFormWebhookEvent[]> {
  const params = new URLSearchParams();
  const limit = options.limit;
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    params.set('limit', String(Math.min(Math.trunc(limit), 500)));
  }

  const query = params.toString();
  const url = query.length
    ? `/reporting-lead-form-webhooks?${query}`
    : '/reporting-lead-form-webhooks';

  const data = await getJson<{ events?: unknown }>(url);
  const events = Array.isArray(data?.events) ? data.events : [];
  return events
    .map(sanitizeLeadFormWebhookEvent)
    .filter((record): record is LeadFormWebhookEvent => record !== null);
}


export type SendLeadFormToPipeResult = {
  organizationId: string | null;
  personId: string | null;
  leadId: string;
  organizationCreated: boolean;
  personCreated: boolean;
  leadCreated: boolean;
  slackNotified: boolean;
  alreadySynced: boolean;
  warnings: string[];
};

export async function sendLeadFormToPipe(eventId: string): Promise<SendLeadFormToPipeResult> {
  const normalizedEventId = sanitizeText(eventId);
  if (!normalizedEventId) {
    throw new Error('El identificador del lead es obligatorio.');
  }

  const response = await postJson<{ result?: unknown }>('/reporting-lead-form-webhooks', { eventId: normalizedEventId });
  const result = response?.result;
  if (!result || typeof result !== 'object') {
    throw new Error('La respuesta del servidor no incluye el resultado de Pipedrive.');
  }

  const raw = result as Record<string, unknown>;
  const leadId = sanitizeText(raw.leadId);
  if (!leadId) {
    throw new Error('La respuesta del servidor no incluye el ID del prospecto creado en Pipedrive.');
  }

  return {
    organizationId: sanitizeText(raw.organizationId),
    personId: sanitizeText(raw.personId),
    leadId,
    organizationCreated: Boolean(raw.organizationCreated),
    personCreated: Boolean(raw.personCreated),
    leadCreated: Boolean(raw.leadCreated),
    slackNotified: Boolean(raw.slackNotified),
    alreadySynced: Boolean(raw.alreadySynced),
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.map((value) => sanitizeText(value)).filter((value): value is string => Boolean(value))
      : [],
  };
}

export type WooCommerceComprasWebhookEvent = {
  id: string;
  createdAt: string | null;
  source: string | null;
  eventName: string | null;
  orderId: string | null;
  orderNumber: string | null;
  presupuesto: string | null;
  orderStatus: string | null;
  orderTotal: string | null;
  currency: string | null;
  customerName: string | null;
  customerEmail: string | null;
  paymentMethod: string | null;
  couponCode: string | null;
  payload: unknown;
};

function sanitizeWooCommerceComprasWebhookEvent(record: unknown): WooCommerceComprasWebhookEvent | null {
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
    source: sanitizeText(raw.source),
    eventName: sanitizeText(raw.eventName ?? raw.event_name),
    orderId: sanitizeText(raw.orderId ?? raw.order_id),
    orderNumber: sanitizeText(raw.orderNumber ?? raw.order_number),
    presupuesto: sanitizeText(raw.presupuesto),
    orderStatus: sanitizeText(raw.orderStatus ?? raw.order_status),
    orderTotal: sanitizeText(raw.orderTotal ?? raw.order_total),
    currency: sanitizeText(raw.currency),
    customerName: sanitizeText(raw.customerName ?? raw.customer_name),
    customerEmail: sanitizeText(raw.customerEmail ?? raw.customer_email),
    paymentMethod: sanitizeText(raw.paymentMethod ?? raw.payment_method),
    couponCode: sanitizeText(raw.couponCode ?? raw.coupon_code),
    payload: raw.payload ?? null,
  } satisfies WooCommerceComprasWebhookEvent;
}

export type FetchWooCommerceComprasWebhookEventsOptions = {
  limit?: number;
};

export async function fetchWooCommerceComprasWebhooks(
  options: FetchWooCommerceComprasWebhookEventsOptions = {}
): Promise<WooCommerceComprasWebhookEvent[]> {
  const params = new URLSearchParams();
  const limit = options.limit;
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    params.set('limit', String(Math.min(Math.trunc(limit), 500)));
  }

  const query = params.toString();
  const url = query.length
    ? `/reporting-woocommerce-compras?${query}`
    : '/reporting-woocommerce-compras';

  const data = await getJson<{ events?: unknown }>(url);
  const events = Array.isArray(data?.events) ? data.events : [];
  return events
    .map(sanitizeWooCommerceComprasWebhookEvent)
    .filter((record): record is WooCommerceComprasWebhookEvent => record !== null);
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
  'descuento'
] as const;

export type TrainerExtraCostFieldKey = (typeof EXTRA_COST_FIELD_KEYS)[number];

export const DEFAULT_TRAINER_EXTRA_COST_VALUES: Partial<Record<TrainerExtraCostFieldKey, number>> =
  {
    precioCosteFormacion: 30,
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
  dealId: string | null;
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
    dealId: sanitizeText(raw.dealId ?? raw.deal_id),
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


export type SyncWooCommerceComprasResult = {
  importedCount: number;
  latestOrderNumber: string | null;
  latestOrderId: string | null;
  inspectedCount: number;
};

export async function syncWooCommerceCompras(): Promise<SyncWooCommerceComprasResult> {
  const response = await putJson<{ result?: unknown }>(`/reporting-woocommerce-compras`, {});
  const result = response?.result;
  if (!result || typeof result !== 'object') {
    throw new Error('La respuesta del servidor no incluye el resultado de la sincronización.');
  }

  const raw = result as Record<string, unknown>;
  return {
    importedCount:
      typeof raw.importedCount === 'number' && Number.isFinite(raw.importedCount)
        ? Math.max(0, Math.trunc(raw.importedCount))
        : 0,
    latestOrderNumber: sanitizeText(raw.latestOrderNumber),
    latestOrderId: sanitizeText(raw.latestOrderId),
    inspectedCount:
      typeof raw.inspectedCount === 'number' && Number.isFinite(raw.inspectedCount)
        ? Math.max(0, Math.trunc(raw.inspectedCount))
        : 0,
  };
}

export async function deleteWooCommerceComprasWebhook(eventId: string): Promise<void> {
  const normalizedEventId = sanitizeText(eventId);
  if (!normalizedEventId) {
    throw new Error('El identificador del webhook es obligatorio.');
  }

  await delJson('/reporting-woocommerce-compras', { eventId: normalizedEventId });
}

export type ComparativaPeriod = {
  startDate: string;
  endDate: string;
};

export type SendWooCommerceCompraToPipeResult = {
  organizationId: string;
  personId: string;
  dealId: string;
  presupuesto: string | null;
  organizationCreated: boolean;
  personCreated: boolean;
  dealCreated: boolean;
  productAdded: boolean;
  notesCreated: string[];
  warnings: string[];
  holdedDocumentId: string | null;
  holdedDocumentType: 'invoice' | null;
  invoiceEmailSent: boolean;
};

export async function sendWooCommerceCompraToPipe(eventId: string): Promise<SendWooCommerceCompraToPipeResult> {
  const normalizedEventId = sanitizeText(eventId);
  if (!normalizedEventId) {
    throw new Error('El identificador del webhook es obligatorio.');
  }

  const response = await postJson<{ result?: unknown }>(`/reporting-woocommerce-compras`, { eventId: normalizedEventId });
  const result = response?.result;
  if (!result || typeof result !== 'object') {
    throw new Error('La respuesta del servidor no incluye el resultado de Pipedrive.');
  }

  const raw = result as Record<string, unknown>;
  return {
    organizationId: sanitizeText(raw.organizationId) ?? '',
    personId: sanitizeText(raw.personId) ?? '',
    dealId: sanitizeText(raw.dealId) ?? '',
    presupuesto: sanitizeText(raw.presupuesto),
    organizationCreated: Boolean(raw.organizationCreated),
    personCreated: Boolean(raw.personCreated),
    dealCreated: Boolean(raw.dealCreated),
    productAdded: Boolean(raw.productAdded),
    notesCreated: Array.isArray(raw.notesCreated)
      ? raw.notesCreated.map((value) => sanitizeText(value)).filter((value): value is string => Boolean(value))
      : [],
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.map((value) => sanitizeText(value)).filter((value): value is string => Boolean(value))
      : [],
    holdedDocumentId: sanitizeText(raw.holdedDocumentId),
    holdedDocumentType: raw.holdedDocumentType === 'invoice' ? 'invoice' : null,
    invoiceEmailSent: Boolean(raw.invoiceEmailSent),
  };
}

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
  canDeliverTraining?: boolean;
  year: number;
  month: number;
  dietas: number | null;
  kilometrajes: number | null;
  pernocta: number | null;
  nocturnidad: number | null;
  festivo: number | null;
  horasExtras: number | null;
  otrosGastos: number | null;
  variable: number | null;
  descuento: number | null;
  totalExtras: number | null;
  commentCost: string | null;
  commentPayroll: string | null;
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
  variable?: number | string | null;
  descuento?: number | string | null;
  totalExtras?: number | string | null;
  commentCost?: string | null;
  commentPayroll?: string | null;
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

export type PayrollReportMetricKey =
  | 'salarioBruto'
  | 'extrasBruto'
  | 'aportacionTrabajadorSs'
  | 'retencionIrpf'
  | 'dietasKilometraje'
  | 'salarioNeto'
  | 'aportacionEmpresarialSs'
  | 'costeTotal';

export type PayrollReportTotals = {
  metrics: Record<PayrollReportMetricKey, number>;
  totalCost: number;
};

export type PayrollReportComparisonMetric = {
  current: number;
  previous: number;
  absoluteDifference: number;
  percentageDifference: number | null;
};

export type PayrollReportResponse = {
  period: {
    year: number;
    month: number;
    quarter: number;
    period: string;
  };
  totals: {
    fixedTrainers: PayrollReportTotals;
    fixedStaff: PayrollReportTotals;
    discontinuousTrainers: PayrollReportTotals;
    discontinuousByService: {
      training: PayrollReportTotals;
      preventive: PayrollReportTotals;
    };
    overall: PayrollReportTotals;
  };
  quarterTotals: {
    fixedTrainers: PayrollReportTotals;
    fixedStaff: PayrollReportTotals;
    discontinuousTrainers: PayrollReportTotals;
    discontinuousByService: {
      training: PayrollReportTotals;
      preventive: PayrollReportTotals;
    };
    overall: PayrollReportTotals;
  };
  comparisons: {
    monthVsPreviousMonth: {
      metrics: Record<PayrollReportMetricKey, PayrollReportComparisonMetric>;
      totalCost: PayrollReportComparisonMetric;
    };
    monthVsSameMonthLastYear: {
      metrics: Record<PayrollReportMetricKey, PayrollReportComparisonMetric>;
      totalCost: PayrollReportComparisonMetric;
    };
    quarterVsPreviousQuarter: {
      metrics: Record<PayrollReportMetricKey, PayrollReportComparisonMetric>;
      totalCost: PayrollReportComparisonMetric;
    };
    quarterVsSameQuarterLastYear: {
      metrics: Record<PayrollReportMetricKey, PayrollReportComparisonMetric>;
      totalCost: PayrollReportComparisonMetric;
    };
    yearToDateVsSameDateLastYear: {
      metrics: Record<PayrollReportMetricKey, PayrollReportComparisonMetric>;
      totalCost: PayrollReportComparisonMetric;
    };
  };
};

export async function fetchReporteNominas(period: string): Promise<PayrollReportResponse> {
  const params = new URLSearchParams();
  if (period.trim().length) {
    params.set('period', period.trim());
  }
  const query = params.toString();
  const url = query.length ? `/reporting-reporte-nominas?${query}` : '/reporting-reporte-nominas';
  return getJson<PayrollReportResponse>(url);
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
  return getJson<SlackDailyAvailabilityResponse>('/daily-availability-slack?force=true');
}

export type SlackDailyTrainersResponse = {
  message: string;
  date: string;
  channel: string;
  text: string;
  sessions: Array<{
    company: string;
    sessionName: string;
    trainers: string[];
  }>;
};

export async function sendDailyTrainersSlackMessage(): Promise<SlackDailyTrainersResponse> {
  return getJson<SlackDailyTrainersResponse>('/daily-trainers-slack?force=true');
}

export type ActuacionesPreventivosInforme = {
  id: string;
  dealId: string;
  cliente: string | null;
  personaContacto: string | null;
  direccionPreventivo: string | null;
  bombero: string | null;
  fechaEjercicio: string;
  turno: string | null;
  partesTrabajo: number;
  asistenciasSanitarias: number;
  derivaronMutua: number;
  derivacionAmbulancia: number;
  observaciones: string | null;
  responsable: string | null;
  createdByUserId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ActuacionesPreventivosFilters = {
  startDate?: string;
  endDate?: string;
};

export type ActuacionesPreventivosUpdatePayload = {
  id: string;
  dealId: string;
  fechaEjercicio: string;
  cliente?: string | null;
  personaContacto?: string | null;
  direccionPreventivo?: string | null;
  bombero?: string | null;
  turno?: string | null;
  partesTrabajo?: number | null;
  asistenciasSanitarias?: number | null;
  derivaronMutua?: number | null;
  derivacionAmbulancia?: number | null;
  observaciones?: string | null;
  responsable?: string | null;
};

export async function updateActuacionesPreventivosInforme(
  payload: ActuacionesPreventivosUpdatePayload
): Promise<ActuacionesPreventivosInforme> {
  const response = await putJson<{ informe?: unknown }>('/actuaciones-preventivos', payload);
  const raw = response?.informe;
  if (!raw || typeof raw !== 'object') {
    throw new Error('Respuesta inválida del servidor.');
  }
  const r = raw as Record<string, unknown>;
  const id = sanitizeText(r.id);
  const dealId = sanitizeText(r.deal_id);
  const fechaEjercicio = sanitizeDate(r.fecha_ejercicio);
  if (!id || !dealId || !fechaEjercicio) {
    throw new Error('Respuesta inválida del servidor.');
  }
  return {
    id,
    dealId,
    cliente: sanitizeText(r.cliente),
    personaContacto: sanitizeText(r.persona_contacto),
    direccionPreventivo: sanitizeText(r.direccion_preventivo),
    bombero: sanitizeText(r.bombero),
    fechaEjercicio,
    turno: sanitizeText(r.turno),
    partesTrabajo: sanitizeInteger(r.partes_trabajo) ?? 0,
    asistenciasSanitarias: sanitizeInteger(r.asistencias_sanitarias) ?? 0,
    derivaronMutua: sanitizeInteger(r.derivaron_mutua) ?? 0,
    derivacionAmbulancia: sanitizeInteger(r.derivacion_ambulancia) ?? 0,
    observaciones: sanitizeText(r.observaciones),
    responsable: sanitizeText(r.responsable),
    createdByUserId: sanitizeText(r.created_by_user_id),
    createdAt: sanitizeDate(r.created_at),
    updatedAt: sanitizeDate(r.updated_at),
  };
}

export async function fetchActuacionesPreventivosInformes(
  filters: ActuacionesPreventivosFilters = {}
): Promise<ActuacionesPreventivosInforme[]> {
  const params = new URLSearchParams();
  if (filters.startDate) {
    params.set('startDate', filters.startDate);
  }
  if (filters.endDate) {
    params.set('endDate', filters.endDate);
  }

  const query = params.toString();
  const url = query.length
    ? `/actuaciones-preventivos?${query}`
    : '/actuaciones-preventivos';

  const response = await getJson<{ informes?: unknown }>(url);
  if (!Array.isArray(response?.informes)) {
    return [];
  }

  return response.informes
    .map((entry): ActuacionesPreventivosInforme | null => {
      if (!entry || typeof entry !== 'object') return null;
      const raw = entry as Record<string, unknown>;

      const id = sanitizeText(raw.id);
      const dealId = sanitizeText(raw.deal_id);
      const fechaEjercicio = sanitizeDate(raw.fecha_ejercicio);
      if (!id || !dealId || !fechaEjercicio) {
        return null;
      }

      return {
        id,
        dealId,
        cliente: sanitizeText(raw.cliente),
        personaContacto: sanitizeText(raw.persona_contacto),
        direccionPreventivo: sanitizeText(raw.direccion_preventivo),
        bombero: sanitizeText(raw.bombero),
        fechaEjercicio,
        turno: sanitizeText(raw.turno),
        partesTrabajo: sanitizeInteger(raw.partes_trabajo) ?? 0,
        asistenciasSanitarias: sanitizeInteger(raw.asistencias_sanitarias) ?? 0,
        derivaronMutua: sanitizeInteger(raw.derivaron_mutua) ?? 0,
        derivacionAmbulancia: sanitizeInteger(raw.derivacion_ambulancia) ?? 0,
        observaciones: sanitizeText(raw.observaciones),
        responsable: sanitizeText(raw.responsable),
        createdByUserId: sanitizeText(raw.created_by_user_id),
        createdAt: sanitizeDate(raw.created_at),
        updatedAt: sanitizeDate(raw.updated_at),
      };
    })
    .filter((entry): entry is ActuacionesPreventivosInforme => entry !== null);
}
