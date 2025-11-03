import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Alert, Button, Spinner, Table } from 'react-bootstrap';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  useReactTable,
  type ColumnDef,
  type HeaderContext,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DealSummary, DealSummarySession } from '../../types/deal';
import {
  FilterToolbar,
  type FilterDefinition,
  type FilterOption,
} from '../../components/table/FilterToolbar';
import {
  FILTER_MULTI_VALUE_SEPARATOR,
  joinFilterValues,
  splitFilterValue,
} from '../../components/table/filterUtils';
import {
  useTableFilterState,
  type TableFiltersState,
  type TableSortingState,
} from '../../hooks/useTableFilterState';
import { SESSION_ESTADOS, type SessionEstado } from '../../api/sessions.types';
import { DEALS_WITHOUT_SESSIONS_FALLBACK_QUERY_KEY } from './queryKeys';
import type { DealsListOptions } from './api/deals.api';
import { fetchProducts } from '../recursos/products.api';

function TrashIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      fill="currentColor"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5.5 5.5a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" />
      <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zm8.382-1 .5-.5H11V2z" />
    </svg>
  );
}

export type BudgetTableLabels = {
  loading: string;
  updating: string;
  errorTitle: string;
  errorRetry: string;
  emptyTitle: string;
  emptyDescription: string;
  emptyRetry: string;
  fallbackNotice: string;
  fallbackNoticeError: string;
  fallbackErrorRetry: string;
};

const DEFAULT_LABELS: BudgetTableLabels = {
  loading: 'Cargando presupuestos desde la base de datos…',
  updating: 'Actualizando listado…',
  errorTitle: 'Error al cargar presupuestos',
  errorRetry: 'Reintentar',
  emptyTitle: 'No hay presupuestos sin sesiones pendientes.',
  emptyDescription: 'Importa un presupuesto para comenzar a planificar la formación.',
  emptyRetry: 'Reintentar',
  fallbackNotice: 'Mostrando los últimos datos disponibles.',
  fallbackNoticeError: 'Mostrando datos guardados porque no se pudo actualizar la lista.',
  fallbackErrorRetry: 'Reintentar',
};

const FOLLOW_UP_HIGHLIGHT_COLUMN_STYLE: React.CSSProperties = {
  backgroundColor: 'rgba(220, 53, 69, 0.08)',
};

const FOLLOW_UP_HIGHLIGHT_VALIDATION_COLUMN_STYLE: React.CSSProperties = {
  ...FOLLOW_UP_HIGHLIGHT_COLUMN_STYLE,
  width: 96,
};

const FOLLOW_UP_DEFAULT_COLUMN_STYLE: React.CSSProperties = {};

const FOLLOW_UP_DEFAULT_VALIDATION_COLUMN_STYLE: React.CSSProperties = {
  width: 96,
};

const SESSION_STATE_LABELS: Record<SessionEstado, string> = {
  BORRADOR: 'Borrador',
  PLANIFICADA: 'Planificada',
  SUSPENDIDA: 'Suspendida',
  CANCELADA: 'Cancelada',
  FINALIZADA: 'Finalizada',
};

export type BudgetServerQueryOptions = {
  fetcher: (options: DealsListOptions) => Promise<DealSummary[]>;
  queryKey?: readonly unknown[];
};

export type BudgetTableVariant = 'default' | 'unworked';

interface BudgetTableProps {
  budgets: DealSummary[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  onSelect: (budget: DealSummary) => void;
  onDelete?: (budget: DealSummary) => Promise<void>;
  labels?: Partial<BudgetTableLabels>;
  enableFallback?: boolean;
  filtersContainer?: HTMLElement | null;
  showFilters?: boolean;
  serverQueryOptions?: BudgetServerQueryOptions;
  variant?: BudgetTableVariant;
}

/** ============ Helpers de presentación ============ */

function safeTrim(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}

function getProductNames(budget: DealSummary): string[] {
  if (Array.isArray(budget.productNames) && budget.productNames.length) {
    return budget.productNames.filter(Boolean).map(String);
  }
  if (Array.isArray(budget.products) && budget.products.length) {
    return budget.products
      .map((p) => safeTrim(p?.name ?? '') ?? safeTrim(p?.code ?? ''))
      .filter((v): v is string => Boolean(v));
  }
  return [];
}

function getProductLabel(budget: DealSummary): { label: string; title?: string } {
  const names = getProductNames(budget);
  if (!names.length) return { label: '—' };
  if (names.length === 1) return { label: names[0] };
  return { label: `${names[0]} (+${names.length - 1})`, title: names.join(', ') };
}

function getOrganizationLabel(budget: DealSummary): string {
  return safeTrim(budget.organization?.name ?? '') ?? '—';
}

function getTitleLabel(budget: DealSummary): string {
  return safeTrim(budget.title ?? '') ?? '—';
}

function getNegocioLabel(budget: DealSummary): string {
  return safeTrim(budget.pipeline_label ?? budget.pipeline_id ?? '') ?? '—';
}

function getBudgetId(budget: DealSummary): string | null {
  const idCandidates = [budget.dealId, budget.deal_id]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length);

  if (idCandidates.length) return idCandidates[0];
  return null;
}

function getSessionStateFilterInfo(
  budget: DealSummary,
): { filterValue: string; labelValue: string } {
  const seen = new Set<SessionEstado>();

  if (Array.isArray(budget.sessions)) {
    budget.sessions.forEach((session) => {
      const rawEstado = session?.estado;
      if (typeof rawEstado !== 'string') {
        return;
      }
      const normalized = rawEstado.toUpperCase();
      if (SESSION_ESTADOS.includes(normalized as SessionEstado)) {
        seen.add(normalized as SessionEstado);
      }
    });
  }

  if (seen.size === 0) {
    return { filterValue: '', labelValue: '' };
  }

  const uniqueStates = Array.from(seen);
  const filterValue = joinFilterValues(uniqueStates);
  const labelValue = uniqueStates
    .map((estado) => SESSION_STATE_LABELS[estado] ?? estado)
    .join(' ');

  return { filterValue, labelValue };
}

function getErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) {
    const trimmed = error.message?.trim();
    return trimmed?.length ? trimmed : null;
  }

  if (typeof error === 'object' && error && 'message' in error) {
    const message = (error as any).message;
    if (typeof message === 'string') {
      const trimmed = message.trim();
      return trimmed.length ? trimmed : null;
    }
  }

  return null;
}

function normalisePipelineKey(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseDateValue(value: string | null | undefined): number | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed.length) {
    return null;
  }

  const directDate = new Date(trimmed);
  if (!Number.isNaN(directDate.getTime())) {
    return directDate.getTime();
  }

  const fallbackMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (fallbackMatch) {
    const [, day, month, year] = fallbackMatch;
    const isoCandidate = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00Z`;
    const fallbackDate = new Date(isoCandidate);
    if (!Number.isNaN(fallbackDate.getTime())) {
      return fallbackDate.getTime();
    }
  }

  return null;
}

function formatDateLabel(timestamp: number | null): string {
  if (timestamp === null) {
    return '—';
  }

  try {
    return new Intl.DateTimeFormat('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(timestamp));
  } catch {
    return '—';
  }
}

type FollowUpLabelKey = 'fundae_label' | 'caes_label' | 'hotel_label' | 'transporte' | 'po';
type FollowUpValidationKey =
  | 'fundae_val'
  | 'caes_val'
  | 'hotel_val'
  | 'transporte_val'
  | 'po_val';

function createSortableHeader(label: string, options?: { ariaLabel?: string; title?: string }) {
  return ({ column }: HeaderContext<DealSummary, unknown>) => {
    const sorted = column.getIsSorted();
    return (
      <button
        type="button"
        className="btn btn-link text-decoration-none text-start text-muted text-uppercase small fw-semibold p-0"
        onClick={column.getToggleSortingHandler()}
        aria-label={options?.ariaLabel}
        title={options?.title}
      >
        {label}
        {sorted && (
          <span className="ms-1" aria-hidden="true">
            {sorted === 'asc' ? '▲' : '▼'}
          </span>
        )}
      </button>
    );
  };
}

function getFollowUpLabel(budget: DealSummary, key: FollowUpLabelKey): string {
  const value = budget[key];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length) {
      return trimmed;
    }
  }
  return '—';
}

function getFollowUpValidationValue(
  budget: DealSummary,
  key: FollowUpValidationKey,
): boolean | null {
  const value = budget[key];
  return typeof value === 'boolean' ? value : null;
}

function getFollowUpValidationSortValue(value: boolean | null): number {
  if (value === true) return 2;
  if (value === false) return 1;
  return 0;
}

function getSessionTimestamp(session: DealSummarySession | null | undefined): number | null {
  if (!session) {
    return null;
  }

  return parseDateValue(session.fecha_inicio_utc ?? session.fecha ?? null);
}

function getNearestSessionStartDateInfo(budget: DealSummary): {
  label: string;
  sortValue: number | null;
} {
  const sessions = Array.isArray(budget.sessions) ? budget.sessions : [];
  const timestamps = sessions
    .map((session) => getSessionTimestamp(session))
    .filter((value): value is number => value !== null);

  if (!timestamps.length) {
    return { label: '—', sortValue: null };
  }

  const now = Date.now();
  let nearest = timestamps[0];
  let smallestDiff = Math.abs(nearest - now);

  for (let index = 1; index < timestamps.length; index += 1) {
    const current = timestamps[index];
    const diff = Math.abs(current - now);
    if (diff < smallestDiff || (diff === smallestDiff && current < nearest)) {
      nearest = current;
      smallestDiff = diff;
    }
  }

  return { label: formatDateLabel(nearest), sortValue: nearest };
}

function ValidationCheck({
  value,
  label,
}: {
  value: boolean | null;
  label: string;
}) {
  if (value === null) {
    return <span className="text-muted">—</span>;
  }

  return (
    <div className="d-flex justify-content-center">
      <input
        type="checkbox"
        className="form-check-input"
        checked={value}
        readOnly
        disabled
        aria-label={value ? `${label} validado` : `${label} no validado`}
      />
    </div>
  );
}

function formatDateIso(timestamp: number | null): string {
  if (timestamp === null) {
    return '';
  }

  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return '';
  }
}

function getTrainingDateTimestamp(budget: DealSummary): number | null {
  const pipelineKey = normalisePipelineKey(budget.pipeline_label ?? budget.pipeline_id ?? '');

  if (pipelineKey.includes('formacion empresa')) {
    const sessions = Array.isArray(budget.sessions) ? budget.sessions : [];
    let earliest: number | null = null;
    for (const session of sessions) {
      const timestamp = parseDateValue(session?.fecha_inicio_utc ?? session?.fecha ?? null);
      if (timestamp === null) {
        continue;
      }
      if (earliest === null || timestamp < earliest) {
        earliest = timestamp;
      }
    }
    return earliest;
  }

  if (pipelineKey.includes('formacion abierta')) {
    return parseDateValue(budget.a_fecha ?? null);
  }

  return null;
}

function getTrainingDateInfo(budget: DealSummary): { label: string; sortValue: number | null } {
  const timestamp = getTrainingDateTimestamp(budget);
  return {
    label: formatDateLabel(timestamp),
    sortValue: timestamp,
  };
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

type BudgetFilterRow = {
  budget: DealSummary;
  values: Record<string, string>;
  normalized: Record<string, string>;
  search: string;
};

const BUDGET_FILTER_ACCESSORS: Record<string, (budget: DealSummary) => string> = {
  deal_id: (budget) => getBudgetId(budget) ?? '',
  title: (budget) => getTitleLabel(budget),
  organization: (budget) => getOrganizationLabel(budget),
  pipeline: (budget) =>
    safeTrim(budget.pipeline_label ?? budget.pipeline_id ?? '') ?? '',
  training_address: (budget) => safeTrim(budget.training_address ?? '') ?? '',
  sede_label: (budget) => safeTrim(budget.sede_label ?? '') ?? '',
  caes_label: (budget) => safeTrim(budget.caes_label ?? '') ?? '',
  fundae_label: (budget) => safeTrim(budget.fundae_label ?? '') ?? '',
  hotel_label: (budget) => safeTrim(budget.hotel_label ?? '') ?? '',
  transporte: (budget) => safeTrim(budget.transporte ?? '') ?? '',
  tipo_servicio: (budget) => safeTrim(budget.tipo_servicio ?? '') ?? '',
  comercial: (budget) => safeTrim(budget.comercial ?? '') ?? '',
  product_names: (budget) => getProductNames(budget).join(' '),
  student_names: (budget) => (budget.studentNames ?? []).join(' '),
  session_state: (budget) => getSessionStateFilterInfo(budget).filterValue,
  training_date: (budget) => {
    const timestamp = getTrainingDateTimestamp(budget);
    const iso = formatDateIso(timestamp);
    const label = formatDateLabel(timestamp);
    return [iso, label].filter(Boolean).join(' ');
  },
};

const BUDGET_FILTER_DEFINITIONS: FilterDefinition[] = [
  { key: 'deal_id', label: 'Presupuesto' },
  { key: 'title', label: 'Título' },
  { key: 'organization', label: 'Empresa' },
  { key: 'pipeline', label: 'Negocio' },
  { key: 'training_address', label: 'Dirección de formación' },
  { key: 'sede_label', label: 'Sede' },
  { key: 'caes_label', label: 'CAES' },
  { key: 'fundae_label', label: 'FUNDAE' },
  { key: 'hotel_label', label: 'Hotel' },
  { key: 'transporte', label: 'Transporte' },
  { key: 'tipo_servicio', label: 'Tipo de servicio' },
  { key: 'session_state', label: 'Estado sesión' },
  { key: 'comercial', label: 'Comercial' },
  { key: 'product_names', label: 'Productos' },
  { key: 'student_names', label: 'Alumnos' },
  { key: 'training_date', label: 'Fecha de formación', type: 'date' },
];

const BUDGET_FILTER_DEFINITION_KEYS = new Set(
  BUDGET_FILTER_DEFINITIONS.map((definition) => definition.key),
);

const BUDGET_FILTER_KEYS = Object.keys(BUDGET_FILTER_ACCESSORS);

const BUDGET_SELECT_FILTER_KEYS = new Set<string>([
  'pipeline',
  'sede_label',
  'caes_label',
  'fundae_label',
  'hotel_label',
  'transporte',
  'tipo_servicio',
  'session_state',
  'comercial',
]);

function createBudgetFilterRow(budget: DealSummary): BudgetFilterRow {
  const values: Record<string, string> = {};
  const normalized: Record<string, string> = {};
  const sessionStateInfo = getSessionStateFilterInfo(budget);
  for (const key of BUDGET_FILTER_KEYS) {
    let raw = '';
    if (key === 'session_state') {
      raw = sessionStateInfo.filterValue;
    } else {
      raw = BUDGET_FILTER_ACCESSORS[key]?.(budget) ?? '';
    }
    values[key] = raw;
    if (key === 'session_state') {
      const combined = [raw, sessionStateInfo.labelValue].filter(Boolean).join(' ');
      normalized[key] = normalizeText(combined);
    } else {
      normalized[key] = normalizeText(raw);
    }
  }
  const search = BUDGET_FILTER_KEYS.map((key) => normalized[key]).join(' ');
  return { budget, values, normalized, search };
}

function subsequenceScore(text: string, token: string): number {
  if (!token.length) return 0;
  let score = 0;
  let position = 0;
  for (const char of token) {
    const index = text.indexOf(char, position);
    if (index === -1) {
      return Number.POSITIVE_INFINITY;
    }
    score += index - position;
    position = index + 1;
  }
  return score;
}

function computeFuzzyScore(text: string, query: string): number {
  const tokens = query
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (const token of tokens) {
    const score = subsequenceScore(text, token);
    if (!Number.isFinite(score)) {
      return Number.POSITIVE_INFINITY;
    }
    total += score;
  }
  return total;
}

function applyBudgetFilters(
  rows: BudgetFilterRow[],
  filters: Record<string, string>,
  search: string,
): BudgetFilterRow[] {
  const filterEntries = Object.entries(filters).filter(
    ([key, value]) => value.trim().length && BUDGET_FILTER_DEFINITION_KEYS.has(key),
  );
  let filtered = rows;
  if (filterEntries.length) {
    filtered = filtered.filter((row) =>
      filterEntries.every(([key, value]) => {
        const parts = splitFilterValue(value);
        if (parts.length > 1) {
          return parts.some((part) => {
            const normalizedPart = normalizeText(part);
            if (!normalizedPart.length) return false;
            const targetValue = row.normalized[key] ?? '';
            return targetValue.includes(normalizedPart);
          });
        }
        const normalizedValue = normalizeText(value);
        if (!normalizedValue.length) return true;
        const target = row.normalized[key] ?? '';
        return target.includes(normalizedValue);
      }),
    );
  }

  const normalizedSearch = normalizeText(search);
  if (!normalizedSearch.length) {
    return filtered;
  }

  const scored = filtered
    .map((row) => ({ row, score: computeFuzzyScore(row.search, normalizedSearch) }))
    .filter((item) => Number.isFinite(item.score));

  scored.sort((a, b) => a.score - b.score);
  return scored.map((item) => item.row);
}

/** ============ Componente ============ */

export function BudgetTable({
  budgets,
  isLoading,
  isFetching,
  error,
  onRetry,
  onSelect,
  onDelete,
  labels: labelsProp,
  enableFallback = true,
  filtersContainer,
  showFilters = true,
  serverQueryOptions,
  variant = 'default',
}: BudgetTableProps) {
  const labels = useMemo(() => ({ ...DEFAULT_LABELS, ...(labelsProp ?? {}) }), [labelsProp]);
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const cachedFallbackBudgets = enableFallback
    ? queryClient.getQueryData<DealSummary[]>(DEALS_WITHOUT_SESSIONS_FALLBACK_QUERY_KEY) ?? null
    : null;

  const hasFallbackBudgets = Boolean(cachedFallbackBudgets && cachedFallbackBudgets.length);
  const shouldUseFallbackForError = Boolean(error) && hasFallbackBudgets;
  const shouldUseFallbackForEmpty =
    !error && !isLoading && budgets.length === 0 && hasFallbackBudgets;
  const isShowingFallback = enableFallback && (shouldUseFallbackForError || shouldUseFallbackForEmpty);
  const fallbackErrorMessage = error ? getErrorMessage(error) : null;

  const effectiveBudgets: DealSummary[] = useMemo(() => {
    if (isShowingFallback && cachedFallbackBudgets && cachedFallbackBudgets.length) {
      return cachedFallbackBudgets;
    }
    return budgets;
  }, [budgets, cachedFallbackBudgets, isShowingFallback]);

  const {
    filters: activeFilters,
    searchValue,
    sorting: sortingFromUrl,
    setSearchValue,
    setFiltersAndSearch,
    setFilterValue,
    clearFilter,
    clearAllFilters,
    setSorting: setSortingInUrl,
  } = useTableFilterState({ tableKey: 'budgets-table' });

  const [sortingState, setSortingState] = useState<TableSortingState>(sortingFromUrl);

  useEffect(() => {
    setSortingState(sortingFromUrl);
  }, [sortingFromUrl]);

  const handleSortingChange = useCallback(
    (next: SortingState) => {
      const normalized = next.map((item) => ({ id: item.id, desc: Boolean(item.desc) }));
      setSortingState(normalized);
      setSortingInUrl(normalized);
    },
    [setSortingInUrl],
  );

  const preparedRows = useMemo(
    () => effectiveBudgets.map((budget) => createBudgetFilterRow(budget)),
    [effectiveBudgets],
  );

  const selectOptionsByKey = useMemo(() => {
    const accumulator = new Map<string, Set<string>>();
    BUDGET_SELECT_FILTER_KEYS.forEach((key) => {
      if (key === 'session_state') {
        accumulator.set(key, new Set<string>(SESSION_ESTADOS));
        return;
      }
      accumulator.set(key, new Set<string>());
    });

    preparedRows.forEach((row) => {
      BUDGET_SELECT_FILTER_KEYS.forEach((key) => {
        const raw = row.values[key] ?? '';
        const trimmed = raw.trim();
        if (!trimmed.length) return;
        const set = accumulator.get(key);
        if (!set) return;
        if (key === 'session_state') {
          const parts = splitFilterValue(raw);
          if (!parts.length) {
            set.add(trimmed);
            return;
          }
          parts.forEach((part) => {
            const normalizedPart = part.trim();
            if (normalizedPart.length) {
              set.add(normalizedPart);
            }
          });
          return;
        }
        set.add(trimmed);
      });
    });

    const result: Record<string, FilterOption[]> = {};
    BUDGET_SELECT_FILTER_KEYS.forEach((key) => {
      const values = accumulator.get(key);
      if (!values || values.size === 0) {
        result[key] = [];
        return;
      }
      const sorted = Array.from(values);
      if (key === 'session_state') {
        sorted.sort((a, b) => {
          const labelA = SESSION_STATE_LABELS[a as SessionEstado] ?? a;
          const labelB = SESSION_STATE_LABELS[b as SessionEstado] ?? b;
          return labelA.localeCompare(labelB, 'es', { sensitivity: 'base' });
        });
        result[key] = sorted.map((value) => ({
          value,
          label: SESSION_STATE_LABELS[value as SessionEstado] ?? value,
        }));
        return;
      }
      sorted.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
      result[key] = sorted.map((value) => ({ value, label: value }));
    });

    return result;
  }, [preparedRows]);

  const productOptionsQuery = useQuery({
    queryKey: ['budget-filter-products'],
    queryFn: fetchProducts,
    enabled: showFilters,
    staleTime: 5 * 60 * 1000,
  });

  const productFilterOptions = useMemo<FilterOption[]>(() => {
    const products = productOptionsQuery.data ?? [];
    if (!products.length) {
      return [];
    }

    const seen = new Set<string>();
    const options: FilterOption[] = [];

    products.forEach((product) => {
      const name = typeof product?.name === 'string' ? product.name.trim() : '';
      const code = typeof product?.code === 'string' ? product.code.trim() : '';
      const value = name.length ? name : code;
      if (!value.length) {
        return;
      }
      const normalized = value.toLocaleLowerCase('es-ES');
      if (seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      const label = name.length && code.length && code !== name ? `${name} (${code})` : value;
      options.push({ value, label });
    });

    options.sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
    return options;
  }, [productOptionsQuery.data]);

  const filterDefinitions = useMemo<FilterDefinition[]>(
    () =>
      BUDGET_FILTER_DEFINITIONS.map((definition) => {
        if (definition.key === 'product_names') {
          return {
            ...definition,
            type: 'select',
            options: productFilterOptions,
            placeholder: definition.placeholder ?? 'Selecciona productos',
          } satisfies FilterDefinition;
        }

        if (!BUDGET_SELECT_FILTER_KEYS.has(definition.key)) {
          return definition;
        }
        const options = selectOptionsByKey[definition.key] ?? [];
        return {
          ...definition,
          type: 'select',
          options,
          placeholder: definition.placeholder ?? 'Selecciona o escribe valores',
        } satisfies FilterDefinition;
      }),
    [productFilterOptions, selectOptionsByKey],
  );

  const filteredRows = useMemo(
    () => applyBudgetFilters(preparedRows, activeFilters, searchValue),
    [preparedRows, activeFilters, searchValue],
  );

  const clientFilteredBudgets = useMemo(
    () => filteredRows.map((row) => row.budget),
    [filteredRows],
  );

  const shouldUseServerFiltering = Boolean(serverQueryOptions?.fetcher) && effectiveBudgets.length > 100_000;

  const serverQueryKey = useMemo(
    () => [
      ...(serverQueryOptions?.queryKey ?? ['budget-table-filters']),
      activeFilters,
      searchValue,
      sortingState,
    ],
    [serverQueryOptions?.queryKey, activeFilters, searchValue, sortingState],
  );

  const serverQuery = useQuery({
    queryKey: serverQueryKey,
    queryFn: () =>
      serverQueryOptions?.fetcher
        ? serverQueryOptions.fetcher({
            filters: activeFilters,
            search: searchValue,
            sorting: sortingState,
          })
        : Promise.resolve<DealSummary[]>([]),
    enabled: shouldUseServerFiltering,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const tableBudgets = shouldUseServerFiltering
    ? serverQuery.data ?? []
    : clientFilteredBudgets;

  const resultCount = tableBudgets.length;

  const hasAppliedFilters = useMemo(() => {
    const hasFilterValues = Object.entries(activeFilters).some(
      ([key, value]) => BUDGET_FILTER_DEFINITION_KEYS.has(key) && value.trim().length > 0,
    );
    return hasFilterValues || searchValue.trim().length > 0;
  }, [activeFilters, searchValue]);

  const tanstackSortingState = useMemo<SortingState>(
    () => sortingState.map((item) => ({ id: item.id, desc: item.desc })),
    [sortingState],
  );

  const showDeleteAction = typeof onDelete === 'function';

  const handleFilterChange = useCallback(
    (key: string, value: string) => {
      const trimmed = value.trim();
      setFilterValue(key, trimmed.length ? trimmed : null);
    },
    [setFilterValue],
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchValue(value);
    },
    [setSearchValue],
  );

  const handleDelete = useCallback(
    async (event: React.MouseEvent, budget: DealSummary) => {
      event.stopPropagation();
      if (!showDeleteAction || !onDelete) return;

      const budgetId = getBudgetId(budget);
      if (!budgetId) {
        window.alert('No se pudo determinar el identificador del presupuesto.');
        return;
      }

      const confirmed = window.confirm(
        '¿Seguro que quieres eliminar este presupuesto? Esta acción no se puede deshacer.'
      );

      if (!confirmed) return;

      try {
        setDeletingId(budgetId);
        await onDelete(budget);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'No se pudo eliminar el presupuesto. Inténtalo de nuevo más tarde.';
        window.alert(message);
      } finally {
        setDeletingId(null);
      }
    },
    [onDelete, showDeleteAction]
  );

  const columns = useMemo<ColumnDef<DealSummary, unknown>[]>(() => {
    const presupuestoColumn: ColumnDef<DealSummary, unknown> = {
      id: 'presupuesto',
      header: createSortableHeader('Presupuesto'),
      accessorFn: (budget) => {
        const budgetId = getBudgetId(budget);
        if (!budgetId) return '';
        const numericId = Number(budgetId);
        return Number.isFinite(numericId) ? numericId : budgetId;
      },
      cell: ({ row }) => {
        const budget = row.original;
        const budgetId = getBudgetId(budget);
        const presupuestoLabel = budgetId ? `#${budgetId}` : '—';
        const title = budget.title && budget.title !== presupuestoLabel ? budget.title : undefined;
        return (
          <span className="fw-semibold" title={title}>
            {presupuestoLabel}
          </span>
        );
      },
      enableSorting: true,
      meta: { style: { width: 160 } },
    };

    const empresaColumn: ColumnDef<DealSummary, unknown> = {
      id: 'empresa',
      header: createSortableHeader('Empresa'),
      accessorFn: (budget) => getOrganizationLabel(budget),
      cell: ({ row }) => getOrganizationLabel(row.original),
    };

    if (variant === 'unworked') {
      const fechaFormacionColumn: ColumnDef<DealSummary, unknown> = {
        id: 'fecha_formacion',
        header: createSortableHeader('Fecha formación'),
        accessorFn: (budget) =>
          getNearestSessionStartDateInfo(budget).sortValue ?? Number.MAX_SAFE_INTEGER,
        cell: ({ row }) => {
          const budget = row.original;
          const info = getNearestSessionStartDateInfo(budget);
          const title = safeTrim(budget.title ?? '') ?? undefined;
          return <span title={title}>{info.label}</span>;
        },
        meta: { style: { width: 160 } },
      };

      const followUpColumns: ColumnDef<DealSummary, unknown>[] = [
        {
          id: 'fundae_label',
          header: createSortableHeader('FUNDAE'),
          accessorFn: (budget) => getFollowUpLabel(budget, 'fundae_label'),
          cell: ({ row }) => getFollowUpLabel(row.original, 'fundae_label'),
          meta: { style: FOLLOW_UP_HIGHLIGHT_COLUMN_STYLE },
        },
        {
          id: 'fundae_val',
          header: createSortableHeader('Val', {
            ariaLabel: 'Validación FUNDAE',
            title: 'Validación FUNDAE',
          }),
          accessorFn: (budget) =>
            getFollowUpValidationSortValue(getFollowUpValidationValue(budget, 'fundae_val')),
          cell: ({ row }) => (
            <ValidationCheck
              value={getFollowUpValidationValue(row.original, 'fundae_val')}
              label="Validación FUNDAE"
            />
          ),
          meta: { style: FOLLOW_UP_HIGHLIGHT_VALIDATION_COLUMN_STYLE },
        },
        {
          id: 'caes_label',
          header: createSortableHeader('CAES'),
          accessorFn: (budget) => getFollowUpLabel(budget, 'caes_label'),
          cell: ({ row }) => getFollowUpLabel(row.original, 'caes_label'),
          meta: { style: FOLLOW_UP_DEFAULT_COLUMN_STYLE },
        },
        {
          id: 'caes_val',
          header: createSortableHeader('Val', {
            ariaLabel: 'Validación CAES',
            title: 'Validación CAES',
          }),
          accessorFn: (budget) =>
            getFollowUpValidationSortValue(getFollowUpValidationValue(budget, 'caes_val')),
          cell: ({ row }) => (
            <ValidationCheck
              value={getFollowUpValidationValue(row.original, 'caes_val')}
              label="Validación CAES"
            />
          ),
          meta: { style: FOLLOW_UP_DEFAULT_VALIDATION_COLUMN_STYLE },
        },
        {
          id: 'hotel_label',
          header: createSortableHeader('Hotel'),
          accessorFn: (budget) => getFollowUpLabel(budget, 'hotel_label'),
          cell: ({ row }) => getFollowUpLabel(row.original, 'hotel_label'),
          meta: { style: FOLLOW_UP_HIGHLIGHT_COLUMN_STYLE },
        },
        {
          id: 'hotel_val',
          header: createSortableHeader('Val', {
            ariaLabel: 'Validación Hotel',
            title: 'Validación Hotel',
          }),
          accessorFn: (budget) =>
            getFollowUpValidationSortValue(getFollowUpValidationValue(budget, 'hotel_val')),
          cell: ({ row }) => (
            <ValidationCheck
              value={getFollowUpValidationValue(row.original, 'hotel_val')}
              label="Validación Hotel"
            />
          ),
          meta: { style: FOLLOW_UP_HIGHLIGHT_VALIDATION_COLUMN_STYLE },
        },
        {
          id: 'transporte',
          header: createSortableHeader('Transporte'),
          accessorFn: (budget) => getFollowUpLabel(budget, 'transporte'),
          cell: ({ row }) => getFollowUpLabel(row.original, 'transporte'),
          meta: { style: FOLLOW_UP_DEFAULT_COLUMN_STYLE },
        },
        {
          id: 'transporte_val',
          header: createSortableHeader('Val', {
            ariaLabel: 'Validación Transporte',
            title: 'Validación Transporte',
          }),
          accessorFn: (budget) =>
            getFollowUpValidationSortValue(getFollowUpValidationValue(budget, 'transporte_val')),
          cell: ({ row }) => (
            <ValidationCheck
              value={getFollowUpValidationValue(row.original, 'transporte_val')}
              label="Validación Transporte"
            />
          ),
          meta: { style: FOLLOW_UP_DEFAULT_VALIDATION_COLUMN_STYLE },
        },
        {
          id: 'po',
          header: createSortableHeader('PO'),
          accessorFn: (budget) => getFollowUpLabel(budget, 'po'),
          cell: ({ row }) => getFollowUpLabel(row.original, 'po'),
          meta: { style: FOLLOW_UP_HIGHLIGHT_COLUMN_STYLE },
        },
        {
          id: 'po_val',
          header: createSortableHeader('Val', {
            ariaLabel: 'Validación PO',
            title: 'Validación PO',
          }),
          accessorFn: (budget) =>
            getFollowUpValidationSortValue(getFollowUpValidationValue(budget, 'po_val')),
          cell: ({ row }) => (
            <ValidationCheck
              value={getFollowUpValidationValue(row.original, 'po_val')}
              label="Validación PO"
            />
          ),
          meta: { style: FOLLOW_UP_HIGHLIGHT_VALIDATION_COLUMN_STYLE },
        },
      ];

      const columnsList: ColumnDef<DealSummary, unknown>[] = [
        presupuestoColumn,
        empresaColumn,
        fechaFormacionColumn,
        ...followUpColumns,
      ];

      if (showDeleteAction) {
        columnsList.push({
          id: 'acciones',
          header: () => <span className="visually-hidden">Acciones</span>,
          cell: ({ row }) => {
            const budget = row.original;
            const budgetId = getBudgetId(budget);
            const isDeleting = deletingId === budgetId;
            return (
              <div className="text-end">
                <button
                  type="button"
                  className="btn btn-link text-danger p-0 border-0"
                  onClick={(event) => handleDelete(event, budget)}
                  disabled={isDeleting}
                  aria-label="Eliminar presupuesto"
                >
                  {isDeleting ? <Spinner animation="border" size="sm" /> : <TrashIcon />}
                </button>
              </div>
            );
          },
          enableSorting: false,
          meta: { style: { width: 56 } },
        });
      }

      return columnsList;
    }

    const baseColumns: ColumnDef<DealSummary, unknown>[] = [
      presupuestoColumn,
      empresaColumn,
      {
        id: 'titulo',
        header: createSortableHeader('Título'),
        accessorFn: (budget) => getTitleLabel(budget),
        cell: ({ row }) => {
          const budget = row.original;
          const titleLabel = getTitleLabel(budget);
          return <span title={budget.title ?? ''}>{titleLabel}</span>;
        },
      },
      {
        id: 'formacion',
        header: createSortableHeader('Formación'),
        accessorFn: (budget) => getProductNames(budget).join(', '),
        cell: ({ row }) => {
          const budget = row.original;
          const names = getProductNames(budget);
          const { label } = getProductLabel(budget);
          return <span title={names.join(', ')}>{label}</span>;
        },
      },
      {
        id: 'fecha_formacion',
        header: createSortableHeader('Fecha formación'),
        accessorFn: (budget) => getTrainingDateInfo(budget).sortValue ?? Number.MAX_SAFE_INTEGER,
        cell: ({ row }) => getTrainingDateInfo(row.original).label,
        meta: { style: { width: 160 } },
      },
      {
        id: 'negocio',
        header: createSortableHeader('Negocio'),
        accessorFn: (budget) => getNegocioLabel(budget),
        cell: ({ row }) => getNegocioLabel(row.original),
      },
    ];

    if (showDeleteAction) {
      baseColumns.push({
        id: 'acciones',
        header: () => <span className="visually-hidden">Acciones</span>,
        cell: ({ row }) => {
          const budget = row.original;
          const budgetId = getBudgetId(budget);
          const isDeleting = deletingId === budgetId;
          return (
            <div className="text-end">
              <button
                type="button"
                className="btn btn-link text-danger p-0 border-0"
                onClick={(event) => handleDelete(event, budget)}
                disabled={isDeleting}
                aria-label="Eliminar presupuesto"
              >
                {isDeleting ? <Spinner animation="border" size="sm" /> : <TrashIcon />}
              </button>
            </div>
          );
        },
        enableSorting: false,
        meta: { style: { width: 56 } },
      });
    }

    return baseColumns;
  }, [deletingId, handleDelete, showDeleteAction, variant]);

  const table = useReactTable<DealSummary>({
    data: tableBudgets,
    columns,
    state: { sorting: tanstackSortingState },
    onSortingChange: handleSortingChange,
    getRowId: (row, index) => getBudgetId(row) ?? row.deal_id ?? row.dealId ?? String(index),
  });

  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const rowModel = table.getRowModel();
  const rows = rowModel.rows;
  const noFilteredResults = hasAppliedFilters && rows.length === 0;

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 64,
    overscan: 8,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0;

  const columnsCount = table.getAllColumns().length;
  const isServerBusy = shouldUseServerFiltering && (serverQuery.isFetching || serverQuery.isLoading);

  if (isLoading) {
    return (
      <div className="text-center py-5 text-muted bg-white rounded-4 shadow-sm">
        <Spinner animation="border" role="status" className="mb-3" />
        <p className="mb-0">{labels.loading}</p>
      </div>
    );
  }

  if (error && !isShowingFallback) {
    const message =
      error instanceof Error
        ? error.message
        : (error as any)?.message || 'No se pudo cargar el listado de presupuestos.';
    return (
      <Alert variant="danger" className="rounded-4 shadow-sm d-flex flex-column flex-md-row align-items-md-center gap-3">
        <div className="flex-grow-1">
          <p className="fw-semibold mb-1">{labels.errorTitle}</p>
          <p className="mb-0 small">{message}</p>
        </div>
        <div>
          <Button variant="outline-danger" onClick={onRetry}>
            {labels.errorRetry}
          </Button>
        </div>
      </Alert>
    );
  }

  if (!effectiveBudgets.length) {
    return (
      <div className="text-center py-5 text-muted bg-white rounded-4 shadow-sm">
        <p className="mb-1 fw-semibold">{labels.emptyTitle}</p>
        {labels.emptyDescription && (
          <p className="mb-0 small">{labels.emptyDescription}</p>
        )}
        <div className="mt-3">
          <Button size="sm" variant="outline-secondary" onClick={onRetry}>
            {labels.emptyRetry}
          </Button>
        </div>
      </div>
    );
  }

  const fallbackNoticeMessage = error ? labels.fallbackNoticeError : labels.fallbackNotice;

  return (
    <div className="rounded-4 shadow-sm bg-white overflow-hidden">
      {isFetching && (
        <div className="d-flex align-items-center gap-2 px-3 py-2 border-bottom text-muted small">
          <Spinner animation="border" size="sm" />
          <span>{labels.updating}</span>
        </div>
      )}
      {isShowingFallback && (
        <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-2 px-3 py-2 border-bottom bg-warning-subtle">
          <div className="text-warning small">
            <div className="fw-semibold">{fallbackNoticeMessage}</div>
            {fallbackErrorMessage && (
              <div className="text-muted">{fallbackErrorMessage}</div>
            )}
          </div>
          <Button size="sm" variant="outline-warning" onClick={onRetry}>
            {labels.fallbackErrorRetry}
          </Button>
        </div>
      )}
      {showFilters
        ? (() => {
            const toolbar = (
              <FilterToolbar
                filters={filterDefinitions}
                activeFilters={activeFilters}
                searchValue={searchValue}
                onSearchChange={handleSearchChange}
                onFilterChange={handleFilterChange}
                onRemoveFilter={clearFilter}
                onClearAll={clearAllFilters}
                resultCount={resultCount}
                isServerBusy={isServerBusy}
                viewStorageKey="budgets-table"
                onApplyFilterState={({ filters, searchValue }) =>
                  setFiltersAndSearch(filters, searchValue)
                }
              />
            );
            if (filtersContainer) {
              return createPortal(toolbar, filtersContainer);
            }
            return <div className="px-3 py-3 border-bottom">{toolbar}</div>;
          })()
        : null}
      <div className="table-responsive" style={{ maxHeight: '70vh' }} ref={tableContainerRef}>
        <Table hover className="mb-0 align-middle">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta as { style?: React.CSSProperties } | undefined;
                  const style = meta?.style;
                  const alignRight = header.column.id === 'acciones';
                  return (
                    <th
                      key={header.id}
                      style={style}
                      className={alignRight ? 'text-end' : undefined}
                      scope="col"
                    >
                      {!header.isPlaceholder &&
                      header.renderHeader()}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columnsCount} className="py-5 text-center text-muted">
                  {noFilteredResults
                    ? 'No hay presupuestos que coincidan con los filtros aplicados.'
                    : 'No hay presupuestos disponibles.'}
                </td>
              </tr>
            ) : (
              <>
                {paddingTop > 0 && (
                  <tr>
                    <td colSpan={columnsCount} style={{ height: `${paddingTop}px` }} />
                  </tr>
                )}
                {virtualRows.map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  const budget = row.original;
                  return (
                    <tr key={row.id} role="button" onClick={() => onSelect(budget)}>
                      {row.getVisibleCells().map((cell) => {
                        const meta = cell.column.columnDef.meta as { style?: React.CSSProperties } | undefined;
                        const style = meta?.style;
                        const alignRight = cell.column.id === 'acciones';
                        return (
                          <td
                            key={cell.id}
                            style={style}
                            className={alignRight ? 'text-end' : undefined}
                          >
                            {cell.renderValue()}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {paddingBottom > 0 && (
                  <tr>
                    <td colSpan={columnsCount} style={{ height: `${paddingBottom}px` }} />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
