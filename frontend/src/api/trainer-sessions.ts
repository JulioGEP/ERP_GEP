// frontend/src/api/trainer-sessions.ts
import { getJson, putJson } from './client';

export type TrainerSessionMobileUnit = {
  id: string;
  name: string | null;
  plate: string | null;
};

export type TrainerSessionTrainer = {
  trainerId: string;
  name: string | null;
  lastName: string | null;
};

export type TrainerSessionDetail = {
  sessionId: string;
  dealId: string;
  budgetNumber: string | null;
  organizationName: string | null;
  commercialName: string | null;
  clientName: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  sessionTitle: string | null;
  formationName: string | null;
  formationTemplate: string | null;
  formationUrl: string | null;
  address: string | null;
  caes: { value: boolean | null; label: string | null };
  fundae: { value: boolean | null; label: string | null };
  startDate: string | null;
  endDate: string | null;
  mobileUnits: TrainerSessionMobileUnit[];
  isCompanyTraining: boolean;
  companionTrainers: TrainerSessionTrainer[];
};

export type TrainerVariantDetail = {
  variantId: string;
  productName: string | null;
  site: string | null;
  date: string | null;
};

export type TrainerSessionsDateEntry = {
  date: string;
  sessions: TrainerSessionDetail[];
  variants: TrainerVariantDetail[];
};

export type TrainerSessionsResponse = {
  dates: TrainerSessionsDateEntry[];
};

export type TrainerSessionTimeLog = {
  id: string;
  trainerId: string;
  sessionId: string | null;
  variantId: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  checkIn: string | null;
  checkOut: string | null;
  recordedByUserId: string | null;
  recordedByName: string | null;
  source: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

function sanitizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function sanitizeBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return null;
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized.length) return null;
    if (['true', '1', 'si', 'sí', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }
  return null;
}

function sanitizeDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function sanitizeMobileUnits(value: unknown): TrainerSessionMobileUnit[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const raw = entry as Partial<TrainerSessionMobileUnit> & { id?: unknown };
      const id = sanitizeString(raw.id);
      if (!id) return null;
      return {
        id,
        name: sanitizeString(raw.name),
        plate: sanitizeString((raw as { plate?: unknown }).plate),
      } satisfies TrainerSessionMobileUnit;
    })
    .filter((unit): unit is TrainerSessionMobileUnit => unit !== null);
}

function sanitizeSession(value: unknown): TrainerSessionDetail | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<TrainerSessionDetail> & {
    sessionId?: unknown;
    dealId?: unknown;
    caes?: unknown;
    fundae?: unknown;
    mobileUnits?: unknown;
    isCompanyTraining?: unknown;
    companionTrainers?: unknown;
  };

  const sessionId = sanitizeString(raw.sessionId);
  const dealId = sanitizeString(raw.dealId);
  if (!sessionId || !dealId) return null;

  const caesRaw = raw.caes;
  const fundaeRaw = raw.fundae;

  const caes =
    caesRaw && typeof caesRaw === 'object'
      ? {
          value: sanitizeBoolean((caesRaw as { value?: unknown }).value),
          label: sanitizeString((caesRaw as { label?: unknown }).label),
        }
      : { value: null, label: null };

  const fundae =
    fundaeRaw && typeof fundaeRaw === 'object'
      ? {
          value: sanitizeBoolean((fundaeRaw as { value?: unknown }).value),
          label: sanitizeString((fundaeRaw as { label?: unknown }).label),
        }
      : { value: null, label: null };

  const companionTrainers = Array.isArray(raw.companionTrainers)
    ? (raw.companionTrainers
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const trainer = entry as Partial<TrainerSessionTrainer> & {
            trainerId?: unknown;
          };
          const trainerId = sanitizeString(trainer.trainerId);
          if (!trainerId) return null;
          return {
            trainerId,
            name: sanitizeString(trainer.name ?? null),
            lastName: sanitizeString(trainer.lastName ?? null),
          } satisfies TrainerSessionTrainer;
        })
        .filter((value): value is TrainerSessionTrainer => value !== null)
      )
    : [];

  return {
    sessionId,
    dealId,
    budgetNumber: sanitizeString(raw.budgetNumber),
    organizationName: sanitizeString(raw.organizationName),
    commercialName: sanitizeString((raw as { commercialName?: unknown }).commercialName),
    clientName: sanitizeString((raw as { clientName?: unknown }).clientName),
    clientPhone: sanitizeString((raw as { clientPhone?: unknown }).clientPhone),
    clientEmail: sanitizeString((raw as { clientEmail?: unknown }).clientEmail),
    sessionTitle: sanitizeString(raw.sessionTitle),
    formationName: sanitizeString(raw.formationName),
    formationTemplate: sanitizeString((raw as { formationTemplate?: unknown }).formationTemplate),
    formationUrl: sanitizeString((raw as { formationUrl?: unknown }).formationUrl),
    address: sanitizeString(raw.address),
    caes,
    fundae,
    startDate: sanitizeDate(raw.startDate),
    endDate: sanitizeDate(raw.endDate),
    mobileUnits: sanitizeMobileUnits(raw.mobileUnits),
    isCompanyTraining: Boolean(raw.isCompanyTraining),
    companionTrainers,
  } satisfies TrainerSessionDetail;
}

function sanitizeVariant(value: unknown): TrainerVariantDetail | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<TrainerVariantDetail> & { variantId?: unknown };
  const variantId = sanitizeString(raw.variantId);
  if (!variantId) return null;

  return {
    variantId,
    productName: sanitizeString(raw.productName),
    site: sanitizeString(raw.site),
    date: sanitizeDate(raw.date),
  } satisfies TrainerVariantDetail;
}

function sanitizeDateEntry(value: unknown): TrainerSessionsDateEntry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<TrainerSessionsDateEntry> & { date?: unknown; sessions?: unknown; variants?: unknown };
  const date = sanitizeString(raw.date);
  if (!date) return null;

  const sessions = Array.isArray(raw.sessions)
    ? (raw.sessions.map(sanitizeSession).filter(Boolean) as TrainerSessionDetail[])
    : [];
  const variants = Array.isArray(raw.variants)
    ? (raw.variants.map(sanitizeVariant).filter(Boolean) as TrainerVariantDetail[])
    : [];

  return { date, sessions, variants } satisfies TrainerSessionsDateEntry;
}

function sanitizeTimeLog(value: unknown): TrainerSessionTimeLog | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<TrainerSessionTimeLog> & {
    id?: unknown;
    trainer_id?: unknown;
    session_id?: unknown;
    variant_id?: unknown;
    scheduled_start?: unknown;
    scheduled_start_utc?: unknown;
    scheduled_end?: unknown;
    scheduled_end_utc?: unknown;
    check_in?: unknown;
    check_in_utc?: unknown;
    check_out?: unknown;
    check_out_utc?: unknown;
    recorded_by_user_id?: unknown;
    recorded_by_name?: unknown;
    created_at?: unknown;
    updated_at?: unknown;
    source?: unknown;
  };

  const id = sanitizeString(raw.id);
  const trainerId = sanitizeString(raw.trainerId ?? raw.trainer_id);
  if (!id || !trainerId) return null;

  const sessionId =
    sanitizeString(raw.sessionId ?? raw.session_id) ?? null;
  const variantId =
    sanitizeString(raw.variantId ?? raw.variant_id) ?? null;

  const scheduledStart =
    sanitizeDate(
      raw.scheduledStart ?? raw.scheduled_start ?? raw.scheduled_start_utc ?? null,
    );
  const scheduledEnd =
    sanitizeDate(raw.scheduledEnd ?? raw.scheduled_end ?? raw.scheduled_end_utc ?? null);
  const checkIn = sanitizeDate(raw.checkIn ?? raw.check_in ?? raw.check_in_utc ?? null);
  const checkOut = sanitizeDate(raw.checkOut ?? raw.check_out ?? raw.check_out_utc ?? null);

  return {
    id,
    trainerId,
    sessionId,
    variantId,
    scheduledStart,
    scheduledEnd,
    checkIn,
    checkOut,
    recordedByUserId:
      sanitizeString(raw.recordedByUserId ?? raw.recorded_by_user_id) ?? null,
    recordedByName:
      sanitizeString(raw.recordedByName ?? raw.recorded_by_name) ?? null,
    source: sanitizeString(raw.source) ?? null,
    createdAt: sanitizeDate(raw.createdAt ?? raw.created_at ?? null),
    updatedAt: sanitizeDate(raw.updatedAt ?? raw.updated_at ?? null),
  } satisfies TrainerSessionTimeLog;
}

type TrainerSessionTimeLogParams =
  | { sessionId: string; variantId?: never }
  | { sessionId?: never; variantId: string };

function buildTimeLogQuery(params: TrainerSessionTimeLogParams): string {
  const search = new URLSearchParams();
  if ('sessionId' in params) {
    const { sessionId } = params as { sessionId: string };
    if (sessionId) search.set('sessionId', sessionId);
  } else if ('variantId' in params) {
    const { variantId } = params as { variantId: string };
    if (variantId) search.set('variantId', variantId);
  }
  return search.toString();
}

export async function fetchTrainerSessions(): Promise<TrainerSessionsResponse> {
  const data = await getJson<any>('/trainer-sessions');
  const entries = Array.isArray(data?.dates) ? data.dates : [];
  const dates = entries.map(sanitizeDateEntry).filter(Boolean) as TrainerSessionsDateEntry[];
  return { dates };
}

export async function fetchTrainerSessionTimeLog(
  params: TrainerSessionTimeLogParams,
): Promise<TrainerSessionTimeLog | null> {
  const query = buildTimeLogQuery(params);
  if (!query.length) return null;
  const data = await getJson<{ timeLog?: unknown }>(`/trainer-session-time-logs?${query}`);
  return sanitizeTimeLog(data?.timeLog ?? null);
}

export type SaveTrainerSessionTimeLogInput = TrainerSessionTimeLogParams & {
  checkIn: string;
  checkOut: string;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
};

export async function saveTrainerSessionTimeLog(
  input: SaveTrainerSessionTimeLogInput,
): Promise<TrainerSessionTimeLog> {
  const { checkIn, checkOut, scheduledStart, scheduledEnd, ...assignment } = input;
  const query = buildTimeLogQuery(assignment as TrainerSessionTimeLogParams);
  if (!query.length) {
    throw new Error('Debes indicar una sesión o variante para guardar el registro horario.');
  }

  const body: Record<string, unknown> = { checkIn, checkOut };
  if (scheduledStart !== undefined) body.scheduledStart = scheduledStart;
  if (scheduledEnd !== undefined) body.scheduledEnd = scheduledEnd;

  const data = await putJson<{ timeLog?: unknown }>(
    `/trainer-session-time-logs?${query}`,
    body,
  );

  const log = sanitizeTimeLog(data?.timeLog ?? null);
  if (!log) {
    throw new Error('Respuesta inválida del servidor al guardar el registro horario.');
  }
  return log;
}
