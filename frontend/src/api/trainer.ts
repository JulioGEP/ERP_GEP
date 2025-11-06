import { getJson, ApiError } from './client';
import type { Trainer } from '../types/trainer';

type TrainerSessionSummary = {
  id: string;
  title: string | null;
  estado: string | null;
  start: string | null;
  end: string | null;
  address: string | null;
  product: { id: string | null; name: string | null; code: string | null } | null;
  deal: { id: string | null; title: string | null } | null;
};

export type TrainerMetrics = {
  plannedSessions: number;
  totalAssignedSessions: number;
  upcomingSessions: number;
  nextSession: TrainerSessionSummary | null;
};

export type TrainerBudget = {
  dealId: string;
  title: string | null;
  pipeline: string | null;
  sedeLabel: string | null;
  trainingAddress: string | null;
  comercial: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  organizationName: string | null;
  sessions: TrainerSessionSummary[];
};

type TrainerProfileResponse = { trainer?: Trainer };
type TrainerMetricsResponse = { metrics?: Partial<TrainerMetrics> | null };
type TrainerBudgetsResponse = { budgets?: unknown[] };

function normalizeString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function normalizeNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeProductRef(payload: any): TrainerSessionSummary['product'] {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const id = normalizeString((payload as { id?: unknown }).id);
  const name = normalizeString((payload as { name?: unknown }).name);
  const code = normalizeString((payload as { code?: unknown }).code);

  if (!id && !name && !code) {
    return null;
  }

  return { id, name, code };
}

function normalizeSessionSummary(payload: any): TrainerSessionSummary | null {
  const id = normalizeString(payload?.id);
  if (!id) return null;

  const dealId = normalizeString(payload?.deal?.id ?? payload?.dealId);
  const dealTitle = normalizeString(payload?.deal?.title ?? payload?.dealTitle);

  return {
    id,
    title: normalizeString(payload?.title),
    estado: normalizeString(payload?.estado),
    start: normalizeString(payload?.start),
    end: normalizeString(payload?.end),
    address: normalizeString(payload?.address ?? payload?.trainingAddress ?? payload?.direccion),
    product: normalizeProductRef(payload?.product),
    deal: dealId || dealTitle ? { id: dealId ?? null, title: dealTitle ?? null } : null,
  };
}

function normalizeSessions(payload: unknown): TrainerSessionSummary[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .map((item) => normalizeSessionSummary(item))
    .filter((session): session is TrainerSessionSummary => session !== null);
}

function normalizeBudget(payload: any): TrainerBudget | null {
  const dealId = normalizeString(payload?.dealId ?? payload?.deal_id);
  if (!dealId) return null;

  return {
    dealId,
    title: normalizeString(payload?.title),
    pipeline: normalizeString(payload?.pipeline ?? payload?.pipeline_id),
    sedeLabel: normalizeString(payload?.sedeLabel ?? payload?.sede_label),
    trainingAddress: normalizeString(payload?.trainingAddress ?? payload?.training_address),
    comercial: normalizeString(payload?.comercial),
    createdAt: normalizeString(payload?.createdAt ?? payload?.created_at),
    updatedAt: normalizeString(payload?.updatedAt ?? payload?.updated_at),
    organizationName: normalizeString(payload?.organizationName ?? payload?.organization?.name),
    sessions: normalizeSessions(payload?.sessions),
  };
}

export async function fetchTrainerProfile(): Promise<Trainer> {
  const data = await getJson<TrainerProfileResponse>('trainer-portal/profile');
  if (!data?.trainer) {
    throw new ApiError('INVALID_RESPONSE', 'No se pudo cargar el perfil del formador.');
  }
  return data.trainer;
}

export async function fetchTrainerMetrics(): Promise<TrainerMetrics> {
  const data = await getJson<TrainerMetricsResponse>('trainer-portal/metrics');
  const metrics = data?.metrics ?? {};
  return {
    plannedSessions: normalizeNumber(metrics.plannedSessions),
    totalAssignedSessions: normalizeNumber(metrics.totalAssignedSessions),
    upcomingSessions: normalizeNumber(metrics.upcomingSessions),
    nextSession: metrics.nextSession ? normalizeSessionSummary(metrics.nextSession) : null,
  };
}

export async function fetchTrainerBudgets(): Promise<TrainerBudget[]> {
  const data = await getJson<TrainerBudgetsResponse>('trainer-portal/budgets');
  const rows = Array.isArray(data?.budgets) ? data.budgets : [];
  return rows
    .map((row) => normalizeBudget(row))
    .filter((budget): budget is TrainerBudget => budget !== null);
}

