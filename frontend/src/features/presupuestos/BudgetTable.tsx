import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Alert, Button, Spinner, Table } from 'react-bootstrap';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DealSummary } from '../../types/deal';
import { FilterToolbar, type FilterDefinition } from '../../components/table/FilterToolbar';
import { splitFilterValue } from '../../components/table/filterUtils';
import { useTableFilterState, type TableSortingState } from '../../hooks/useTableFilterState';
import {
  DEALS_WITHOUT_SESSIONS_FALLBACK_QUERY_KEY,
} from './queryKeys';
import { fetchDealsWithoutSessions as fetchDealsWithoutSessionsApi } from './api';

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

type BudgetTableLabels = {
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
  return safeTrim(budget.pipeline_id ?? budget.pipeline_label ?? '') ?? '—';
}

function getBudgetId(budget: DealSummary): string | null {
  const idCandidates = [budget.dealId, budget.deal_id]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length);

  if (idCandidates.length) return idCandidates[0];
  return null;
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
  pipeline_id: (budget) => safeTrim(budget.pipeline_id ?? '') ?? '',
  training_address: (budget) => safeTrim(budget.training_address ?? '') ?? '',
  sede_label: (budget) => safeTrim(budget.sede_label ?? '') ?? '',
  caes_label: (budget) => safeTrim(budget.caes_label ?? '') ?? '',
  fundae_label: (budget) => safeTrim(budget.fundae_label ?? '') ?? '',
  hotel_label: (budget) => safeTrim(budget.hotel_label ?? '') ?? '',
  tipo_servicio: (budget) => safeTrim(budget.tipo_servicio ?? '') ?? '',
  mail_invoice: (budget) => safeTrim(budget.mail_invoice ?? '') ?? '',
  comercial: (budget) => safeTrim(budget.comercial ?? '') ?? '',
  a_fecha: (budget) => safeTrim(budget.a_fecha ?? '') ?? '',
  w_id_variation: (budget) => safeTrim(budget.w_id_variation ?? '') ?? '',
  presu_holded: (budget) => safeTrim(budget.presu_holded ?? '') ?? '',
  modo_reserva: (budget) => safeTrim(budget.modo_reserva ?? '') ?? '',
  hours: (budget) => (budget.hours != null ? String(budget.hours) : ''),
  product_names: (budget) => getProductNames(budget).join(' '),
  sessions: (budget) =>
    (Array.isArray(budget.sessions) ? budget.sessions : [])
      .map((session) => safeTrim(session?.fecha_inicio_utc ?? session?.fecha ?? '') ?? '')
      .filter(Boolean)
      .join(' '),
  person_name: (budget) => {
    const first = safeTrim(budget.person?.first_name ?? '') ?? '';
    const last = safeTrim(budget.person?.last_name ?? '') ?? '';
    return [first, last].filter(Boolean).join(' ');
  },
  person_email: (budget) => safeTrim(budget.person?.email ?? '') ?? '',
  person_phone: (budget) => safeTrim(budget.person?.phone ?? '') ?? '',
  training_date: (budget) => getTrainingDateInfo(budget).label,
  negocio: (budget) => getNegocioLabel(budget),
};

const BUDGET_FILTER_DEFINITIONS: FilterDefinition[] = [
  { key: 'deal_id', label: 'Presupuesto' },
  { key: 'title', label: 'Título' },
  { key: 'organization', label: 'Empresa' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'pipeline_id', label: 'Pipeline (ID)' },
  { key: 'training_address', label: 'Dirección de formación' },
  { key: 'sede_label', label: 'Sede' },
  { key: 'caes_label', label: 'CAES' },
  { key: 'fundae_label', label: 'FUNDAE' },
  { key: 'hotel_label', label: 'Hotel' },
  { key: 'tipo_servicio', label: 'Tipo de servicio' },
  { key: 'mail_invoice', label: 'Email de facturación' },
  { key: 'comercial', label: 'Comercial' },
  { key: 'a_fecha', label: 'A fecha' },
  { key: 'w_id_variation', label: 'ID variación' },
  { key: 'presu_holded', label: 'Presupuesto retenido' },
  { key: 'modo_reserva', label: 'Modo reserva' },
  { key: 'hours', label: 'Horas', type: 'number' },
  { key: 'product_names', label: 'Productos' },
  { key: 'sessions', label: 'Sesiones' },
  { key: 'person_name', label: 'Persona de contacto' },
  { key: 'person_email', label: 'Email de contacto' },
  { key: 'person_phone', label: 'Teléfono de contacto' },
  { key: 'training_date', label: 'Fecha de formación' },
  { key: 'negocio', label: 'Negocio' },
];

const BUDGET_FILTER_KEYS = Object.keys(BUDGET_FILTER_ACCESSORS);

function createBudgetFilterRow(budget: DealSummary): BudgetFilterRow {
  const values: Record<string, string> = {};
  const normalized: Record<string, string> = {};
  for (const key of BUDGET_FILTER_KEYS) {
    const raw = BUDGET_FILTER_ACCESSORS[key]?.(budget) ?? '';
    values[key] = raw;
    normalized[key] = normalizeText(raw);
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
  const filterEntries = Object.entries(filters).filter(([, value]) => value.trim().length);
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

  const filteredRows = useMemo(
    () => applyBudgetFilters(preparedRows, activeFilters, searchValue),
    [preparedRows, activeFilters, searchValue],
  );

  const clientFilteredBudgets = useMemo(
    () => filteredRows.map((row) => row.budget),
    [filteredRows],
  );

  const shouldUseServerFiltering = effectiveBudgets.length > 100_000;

  const serverQuery = useQuery({
    queryKey: [
      'budget-table-filters',
      activeFilters,
      searchValue,
      sortingState,
    ],
    queryFn: () =>
      fetchDealsWithoutSessionsApi({
        filters: activeFilters,
        search: searchValue,
        sorting: sortingState,
      }),
    enabled: shouldUseServerFiltering,
    keepPreviousData: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const tableBudgets = shouldUseServerFiltering
    ? serverQuery.data ?? []
    : clientFilteredBudgets;

  const resultCount = tableBudgets.length;

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

  const columns = useMemo<ColumnDef<DealSummary>[]>(() => {
    const baseColumns: ColumnDef<DealSummary>[] = [
      {
        id: 'presupuesto',
        header: ({ column }) => {
          const sorted = column.getIsSorted();
          return (
            <button
              type="button"
              className="btn btn-link text-decoration-none text-start text-muted text-uppercase small fw-semibold p-0"
              onClick={column.getToggleSortingHandler()}
            >
              Presupuesto
              {sorted && (
                <span className="ms-1" aria-hidden="true">
                  {sorted === 'asc' ? '▲' : '▼'}
                </span>
              )}
            </button>
          );
        },
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
      },
      {
        id: 'empresa',
        header: ({ column }) => {
          const sorted = column.getIsSorted();
          return (
            <button
              type="button"
              className="btn btn-link text-decoration-none text-start text-muted text-uppercase small fw-semibold p-0"
              onClick={column.getToggleSortingHandler()}
            >
              Empresa
              {sorted && (
                <span className="ms-1" aria-hidden="true">
                  {sorted === 'asc' ? '▲' : '▼'}
                </span>
              )}
            </button>
          );
        },
        accessorFn: (budget) => getOrganizationLabel(budget),
        cell: ({ row }) => getOrganizationLabel(row.original),
      },
      {
        id: 'titulo',
        header: ({ column }) => {
          const sorted = column.getIsSorted();
          return (
            <button
              type="button"
              className="btn btn-link text-decoration-none text-start text-muted text-uppercase small fw-semibold p-0"
              onClick={column.getToggleSortingHandler()}
            >
              Título
              {sorted && (
                <span className="ms-1" aria-hidden="true">
                  {sorted === 'asc' ? '▲' : '▼'}
                </span>
              )}
            </button>
          );
        },
        accessorFn: (budget) => getTitleLabel(budget),
        cell: ({ row }) => {
          const budget = row.original;
          const titleLabel = getTitleLabel(budget);
          return <span title={budget.title ?? ''}>{titleLabel}</span>;
        },
      },
      {
        id: 'formacion',
        header: ({ column }) => {
          const sorted = column.getIsSorted();
          return (
            <button
              type="button"
              className="btn btn-link text-decoration-none text-start text-muted text-uppercase small fw-semibold p-0"
              onClick={column.getToggleSortingHandler()}
            >
              Formación
              {sorted && (
                <span className="ms-1" aria-hidden="true">
                  {sorted === 'asc' ? '▲' : '▼'}
                </span>
              )}
            </button>
          );
        },
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
        header: ({ column }) => {
          const sorted = column.getIsSorted();
          return (
            <button
              type="button"
              className="btn btn-link text-decoration-none text-start text-muted text-uppercase small fw-semibold p-0"
              onClick={column.getToggleSortingHandler()}
            >
              Fecha formación
              {sorted && (
                <span className="ms-1" aria-hidden="true">
                  {sorted === 'asc' ? '▲' : '▼'}
                </span>
              )}
            </button>
          );
        },
        accessorFn: (budget) => getTrainingDateInfo(budget).sortValue ?? Number.MAX_SAFE_INTEGER,
        cell: ({ row }) => getTrainingDateInfo(row.original).label,
        meta: { style: { width: 160 } },
      },
      {
        id: 'negocio',
        header: ({ column }) => {
          const sorted = column.getIsSorted();
          return (
            <button
              type="button"
              className="btn btn-link text-decoration-none text-start text-muted text-uppercase small fw-semibold p-0"
              onClick={column.getToggleSortingHandler()}
            >
              Negocio
              {sorted && (
                <span className="ms-1" aria-hidden="true">
                  {sorted === 'asc' ? '▲' : '▼'}
                </span>
              )}
            </button>
          );
        },
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
  }, [deletingId, handleDelete, showDeleteAction]);

  const table = useReactTable({
    data: tableBudgets,
    columns,
    state: { sorting: tanstackSortingState },
    onSortingChange: handleSortingChange,
    getRowId: (row, index) => getBudgetId(row) ?? row.deal_id ?? row.dealId ?? String(index),
  });

  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const rowModel = table.getRowModel();
  const rows = rowModel.rows;

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
      {(() => {
        const toolbar = (
          <FilterToolbar
            filters={BUDGET_FILTER_DEFINITIONS}
            activeFilters={activeFilters}
            searchValue={searchValue}
            onSearchChange={handleSearchChange}
            onFilterChange={handleFilterChange}
            onRemoveFilter={clearFilter}
            onClearAll={clearAllFilters}
            resultCount={resultCount}
            isServerBusy={isServerBusy}
            onSaveView={() => console.info('Guardar vista de presupuestos')}
          />
        );
        if (filtersContainer) {
          return createPortal(toolbar, filtersContainer);
        }
        return <div className="px-3 py-3 border-bottom">{toolbar}</div>;
      })()}
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
                      {header.isPlaceholder ? null : header.renderHeader()}
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
