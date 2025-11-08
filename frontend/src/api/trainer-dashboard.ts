// frontend/src/api/trainer-dashboard.ts
import { getJson, toNonNegativeInteger } from './client';

export type TrainerDashboardMetrics = {
  totalAssigned: number;
  companySessions: number;
  gepServicesSessions: number;
  openTrainingVariants: number;
};

export type TrainerDashboardSession = {
  sessionId: string;
  budgetNumber: string | null;
  sessionTitle: string | null;
  productName: string | null;
  address: string | null;
  mobileUnits: Array<{ id: string; name: string | null; plate: string | null }>;
};

export type TrainerDashboardResponse = {
  metrics: TrainerDashboardMetrics;
  sessions: TrainerDashboardSession[];
  generatedAt: string | null;
};

function sanitizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function sanitizeMobileUnits(value: unknown): TrainerDashboardSession['mobileUnits'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const raw = entry as { id?: unknown; name?: unknown; plate?: unknown };
      const id = sanitizeString(raw.id);
      if (!id) return null;
      return {
        id,
        name: sanitizeString(raw.name),
        plate: sanitizeString(raw.plate),
      };
    })
    .filter((item): item is TrainerDashboardSession['mobileUnits'][number] => item !== null);
}

function sanitizeSession(value: unknown): TrainerDashboardSession | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<TrainerDashboardSession> & {
    mobileUnits?: unknown;
  };
  const sessionId = sanitizeString(raw.sessionId);
  if (!sessionId) return null;
  return {
    sessionId,
    budgetNumber: sanitizeString(raw.budgetNumber),
    sessionTitle: sanitizeString(raw.sessionTitle),
    productName: sanitizeString(raw.productName),
    address: sanitizeString(raw.address),
    mobileUnits: sanitizeMobileUnits(raw.mobileUnits),
  };
}

function sanitizeDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function fetchTrainerDashboard(): Promise<TrainerDashboardResponse> {
  const response = await getJson<any>('/trainer-dashboard');
  const metrics = response?.metrics ?? {};
  const sessions = Array.isArray(response?.sessions)
    ? (response.sessions
        .map(sanitizeSession)
        .filter(Boolean) as TrainerDashboardSession[])
    : [];

  return {
    metrics: {
      totalAssigned: toNonNegativeInteger(metrics.totalAssigned),
      companySessions: toNonNegativeInteger(metrics.companySessions),
      gepServicesSessions: toNonNegativeInteger(metrics.gepServicesSessions),
      openTrainingVariants: toNonNegativeInteger(metrics.openTrainingVariants),
    },
    sessions,
    generatedAt: sanitizeDate(response?.generatedAt),
  };
}
