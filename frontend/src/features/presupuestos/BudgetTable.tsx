import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Spinner, Table } from 'react-bootstrap';
import { useQueryClient } from '@tanstack/react-query';
import type { DealSummary } from '../../types/deal';
import { useDataTable } from '../../hooks/useDataTable';
import { SortableHeader } from '../../components/table/SortableHeader';
import { DataTablePagination } from '../../components/table/DataTablePagination';
import {
  DEALS_WITHOUT_SESSIONS_FALLBACK_QUERY_KEY,
} from './queryKeys';

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

  const getSortValue = useCallback((budget: DealSummary, column: string) => {
    switch (column) {
      case 'presupuesto':
        const budgetId = getBudgetId(budget);
        if (!budgetId) return null;
        const numericId = Number(budgetId);
        return Number.isFinite(numericId) ? numericId : budgetId;
      case 'empresa':
        return getOrganizationLabel(budget);
      case 'titulo':
        return getTitleLabel(budget);
      case 'formacion':
        return getProductNames(budget).join(', ');
      case 'fecha_formacion':
        return getTrainingDateInfo(budget).sortValue;
      case 'negocio':
        return getNegocioLabel(budget);
      default:
        return null;
    }
  }, []);

  const {
    pageItems,
    sortState,
    currentPage,
    totalPages,
    totalItems,
    pageSize,
    requestSort,
    goToPage,
  } = useDataTable(effectiveBudgets, {
    getSortValue,
  });

  const showDeleteAction = typeof onDelete === 'function';

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
      <div className="table-responsive">
        <Table hover className="mb-0 align-middle">
          <thead>
            <tr>
              <SortableHeader
                columnKey="presupuesto"
                label="Presupuesto"
              sortState={sortState}
              onSort={requestSort}
              style={{ width: 160 }}
            />
            <SortableHeader
              columnKey="empresa"
              label="Empresa"
              sortState={sortState}
              onSort={requestSort}
            />
            <SortableHeader
              columnKey="titulo"
              label="Título"
              sortState={sortState}
              onSort={requestSort}
            />
            <SortableHeader
              columnKey="formacion"
              label="Formación"
              sortState={sortState}
              onSort={requestSort}
            />
            <SortableHeader
              columnKey="fecha_formacion"
              label="Fecha formación"
              sortState={sortState}
              onSort={requestSort}
              style={{ width: 160 }}
            />
            <SortableHeader
              columnKey="negocio"
              label="Negocio"
              sortState={sortState}
              onSort={requestSort}
              style={{ width: showDeleteAction ? 120 : 140 }}
            />
            {showDeleteAction && (
              <th className="text-end" style={{ width: 56 }}>
                <span className="visually-hidden">Acciones</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {pageItems.map((budget, index) => {
            const names = getProductNames(budget);
            const { label: productLabel } = getProductLabel(budget);

            const id = getBudgetId(budget);
            const presupuestoLabel = id ? `#${id}` : '—';
            const presupuestoTitle = budget.title && budget.title !== presupuestoLabel ? budget.title : undefined;
            const organizationLabel = getOrganizationLabel(budget);
            const titleLabel = getTitleLabel(budget);
            const negocioLabel = getNegocioLabel(budget);
            const trainingDateInfo = getTrainingDateInfo(budget);

            const rowKey = id ?? `${organizationLabel}-${titleLabel}-${index}`;

            return (
              <tr key={rowKey} role="button" onClick={() => onSelect(budget)}>
                <td className="fw-semibold" title={presupuestoTitle}>
                  {presupuestoLabel}
                </td>
                <td>{organizationLabel}</td>
                <td title={budget.title ?? ''}>{titleLabel}</td>
                <td title={names.join(', ')}>{productLabel}</td>
                <td>{trainingDateInfo.label}</td>
                <td>{negocioLabel}</td>
                {showDeleteAction && (
                  <td className="text-end">
                    <button
                      type="button"
                      className="btn btn-link text-danger p-0 border-0"
                      onClick={(event) => handleDelete(event, budget)}
                      disabled={deletingId === id}
                      aria-label="Eliminar presupuesto"
                    >
                      {deletingId === id ? <Spinner animation="border" size="sm" /> : <TrashIcon />}
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
          </tbody>
        </Table>
      </div>
      <DataTablePagination
        page={currentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        totalItems={totalItems}
        onPageChange={goToPage}
      />
    </div>
  );
}
