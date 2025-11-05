// frontend/src/api/dashboard.ts
import { getJson, toNonNegativeInteger } from './client';

type RawDashboardTrendPoint = {
  fecha?: unknown;
  totalSesiones?: unknown;
  totalVariantesFormacionAbierta?: unknown;
};

type RawDashboardMetricsResponse = {
  sessions?: {
    borrador?: unknown;
    suspendida?: unknown;
    porFinalizar?: unknown;
    formacionAbiertaSinAsignar?: unknown;
  } | null;
  followUp?: {
    caesPorTrabajar?: unknown;
    fundaePorTrabajar?: unknown;
    hotelPorTrabajar?: unknown;
    poPorTrabajar?: unknown;
    transportePorTrabajar?: unknown;
  } | null;
  generatedAt?: unknown;
  tendencias?: {
    sesionesVsVariantes?: RawDashboardTrendPoint[] | null;
  } | null;
};

export type DashboardTrendPoint = {
  fecha: string;
  totalSesiones: number;
  totalVariantesFormacionAbierta: number;
};

export type DashboardMetrics = {
  sessions: {
    borrador: number;
    suspendida: number;
    porFinalizar: number;
    formacionAbiertaSinAsignar: number;
  };
  followUp: {
    caesPorTrabajar: number;
    fundaePorTrabajar: number;
    hotelPorTrabajar: number;
    poPorTrabajar: number;
    transportePorTrabajar: number;
  };
  generatedAt: string | null;
  tendencias: {
    sesionesVsVariantes: DashboardTrendPoint[];
  };
};

function sanitizeIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sanitizeTrendPoint(input: RawDashboardTrendPoint | null | undefined): DashboardTrendPoint | null {
  if (!input || typeof input !== 'object') return null;
  const fechaCandidate = typeof input.fecha === 'string' ? input.fecha.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaCandidate)) {
    return null;
  }

  return {
    fecha: fechaCandidate,
    totalSesiones: toNonNegativeInteger(input.totalSesiones),
    totalVariantesFormacionAbierta: toNonNegativeInteger(
      input.totalVariantesFormacionAbierta,
    ),
  } satisfies DashboardTrendPoint;
}

function sanitizeTrendPoints(raw: RawDashboardMetricsResponse['tendencias']): DashboardTrendPoint[] {
  if (!raw || typeof raw !== 'object') return [];
  const rawPoints = Array.isArray(raw.sesionesVsVariantes) ? raw.sesionesVsVariantes : [];
  return rawPoints
    .map((point) => sanitizeTrendPoint(point))
    .filter((point): point is DashboardTrendPoint => point !== null);
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
      formacionAbiertaSinAsignar: toNonNegativeInteger(
        response.sessions?.formacionAbiertaSinAsignar,
      ),
    },
    followUp: {
      caesPorTrabajar: toNonNegativeInteger(response.followUp?.caesPorTrabajar),
      fundaePorTrabajar: toNonNegativeInteger(response.followUp?.fundaePorTrabajar),
      hotelPorTrabajar: toNonNegativeInteger(response.followUp?.hotelPorTrabajar),
      poPorTrabajar: toNonNegativeInteger(response.followUp?.poPorTrabajar),
      transportePorTrabajar: toNonNegativeInteger(response.followUp?.transportePorTrabajar),
    },
    generatedAt: sanitizeIsoDate(response.generatedAt),
    tendencias: {
      sesionesVsVariantes: sanitizeTrendPoints(response.tendencias),
    },
  };
}
