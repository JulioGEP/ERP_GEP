// frontend/src/api/dashboard.ts
import { getJson, toNonNegativeInteger } from './client';

type RawDashboardMetricsResponse = {
  sessions?: {
    borrador?: unknown;
    suspendida?: unknown;
    porFinalizar?: unknown;
  } | null;
  followUp?: {
    caesPorTrabajar?: unknown;
    fundaePorTrabajar?: unknown;
    hotelPorTrabajar?: unknown;
    poPorTrabajar?: unknown;
    transportePorTrabajar?: unknown;
  } | null;
  generatedAt?: unknown;
  sessionsTimeline?: {
    startDate?: unknown;
    endDate?: unknown;
    points?: unknown;
  } | null;
};

export type DashboardMetrics = {
  sessions: {
    borrador: number;
    suspendida: number;
    porFinalizar: number;
  };
  followUp: {
    caesPorTrabajar: number;
    fundaePorTrabajar: number;
    hotelPorTrabajar: number;
    poPorTrabajar: number;
    transportePorTrabajar: number;
  };
  generatedAt: string | null;
  sessionsTimeline: {
    startDate: string | null;
    endDate: string | null;
    points: Array<{
      date: string;
      totalSessions: number;
      formacionAbiertaSessions: number;
    }>;
  };
};

function sanitizeIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sanitizeDateOnly(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const date = new Date(`${trimmed}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : trimmed;
}

type RawTimelinePoint = {
  date?: unknown;
  totalSessions?: unknown;
  formacionAbiertaSessions?: unknown;
};

function sanitizeTimelinePoint(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const raw = value as RawTimelinePoint;
  const date = sanitizeDateOnly(raw.date);
  if (!date) return null;
  return {
    date,
    totalSessions: toNonNegativeInteger(raw.totalSessions),
    formacionAbiertaSessions: toNonNegativeInteger(raw.formacionAbiertaSessions),
  };
}

function sanitizeTimeline(
  value: RawDashboardMetricsResponse['sessionsTimeline'],
): DashboardMetrics['sessionsTimeline'] {
  if (!value || typeof value !== 'object') {
    return { startDate: null, endDate: null, points: [] };
  }
  const startDate = sanitizeDateOnly(value.startDate) ?? null;
  const endDate = sanitizeDateOnly(value.endDate) ?? null;
  const points: DashboardMetrics['sessionsTimeline']['points'] = Array.isArray(
    value.points,
  )
    ? (value.points
        .map(sanitizeTimelinePoint)
        .filter(Boolean) as DashboardMetrics['sessionsTimeline']['points'])
    : [];
  return { startDate, endDate, points };
}

export async function fetchDashboardMetrics(): Promise<DashboardMetrics> {
  const response = await getJson<RawDashboardMetricsResponse & { ok?: boolean }>(
    '/dashboard',
  );

  return {
    sessions: {
      borrador: toNonNegativeInteger(response.sessions?.borrador),
      suspendida: toNonNegativeInteger(response.sessions?.suspendida),
      porFinalizar: toNonNegativeInteger(response.sessions?.porFinalizar),
    },
    followUp: {
      caesPorTrabajar: toNonNegativeInteger(response.followUp?.caesPorTrabajar),
      fundaePorTrabajar: toNonNegativeInteger(response.followUp?.fundaePorTrabajar),
      hotelPorTrabajar: toNonNegativeInteger(response.followUp?.hotelPorTrabajar),
      poPorTrabajar: toNonNegativeInteger(response.followUp?.poPorTrabajar),
      transportePorTrabajar: toNonNegativeInteger(response.followUp?.transportePorTrabajar),
    },
    generatedAt: sanitizeIsoDate(response.generatedAt),
    sessionsTimeline: sanitizeTimeline(response.sessionsTimeline),
  };
}

