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
};

function sanitizeIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function fetchDashboardMetrics(): Promise<DashboardMetrics> {
  const response = await getJson<RawDashboardMetricsResponse & { ok?: boolean }>(
    '/api/dashboard',
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
  };
}

