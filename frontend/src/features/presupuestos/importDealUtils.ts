import type { ImportDealResult } from './api';
import type { DealDetail, DealSummary } from '../../types/deal';

export const DEAL_NOT_WON_ERROR_CODE = 'DEAL_NOT_WON';
export const DEAL_NOT_WON_ERROR_MESSAGE = 'Este negocio no está Ganado, no lo podemos subir';

type ImportResultDeal = DealDetail | DealSummary | null;

type UnknownWithDeal = {
  deal?: ImportResultDeal;
  warnings?: unknown;
};

const IGNORED_WARNINGS = new Set<string>([
  'Este presupuesto ya existe en la base de datos.',
]);

function normalizeWarnings(warnings: unknown): string[] {
  if (!Array.isArray(warnings)) return [];
  return warnings
    .map((warning) => (typeof warning === 'string' ? warning.trim() : ''))
    .filter((warning) => warning.length > 0 && !IGNORED_WARNINGS.has(warning));
}

export function normalizeImportDealResult(payload: unknown): {
  deal: ImportResultDeal;
  warnings: string[];
} {
  if (!payload || typeof payload !== 'object') {
    return { deal: null, warnings: [] };
  }

  const castPayload = payload as UnknownWithDeal;
  const normalizedWarnings = normalizeWarnings(castPayload.warnings);

  if ('deal' in castPayload) {
    return { deal: castPayload.deal ?? null, warnings: normalizedWarnings };
  }

  // Compatibilidad con respuestas antiguas que devolvían directamente el deal
  return { deal: payload as DealDetail | DealSummary, warnings: normalizedWarnings };
}

export function isImportDealResult(payload: unknown): payload is ImportDealResult {
  if (!payload || typeof payload !== 'object') return false;
  return 'deal' in (payload as Record<string, unknown>);
}
