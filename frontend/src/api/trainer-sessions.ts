// frontend/src/api/trainer-sessions.ts
import { getJson } from './client';

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

export async function fetchTrainerSessions(): Promise<TrainerSessionsResponse> {
  const data = await getJson<any>('/trainer-sessions');
  const entries = Array.isArray(data?.dates) ? data.dates : [];
  const dates = entries.map(sanitizeDateEntry).filter(Boolean) as TrainerSessionsDateEntry[];
  return { dates };
}
