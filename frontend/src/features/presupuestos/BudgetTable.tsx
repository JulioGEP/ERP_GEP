import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Spinner, Table } from 'react-bootstrap';
import type { DealSummary } from '../../types/deal';
import { fetchDealsWithoutSessions } from './api'; // ← usar API común
import { formatSedeLabel } from './formatSedeLabel';
import { useDataTable } from '../../hooks/useDataTable';
import { SortableHeader } from '../../components/table/SortableHeader';
import { DataTablePagination } from '../../components/table/DataTablePagination';

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

interface BudgetTableProps {
  budgets: DealSummary[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  onSelect: (budget: DealSummary) => void;
  onDelete?: (budget: DealSummary) => Promise<void>;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
}

/** ============ Helpers de presentación ============ */

function safeTrim(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}

function toStringValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
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

function getSedeLabel(budget: DealSummary): string {
  return safeTrim(formatSedeLabel(budget.sede_label) ?? '') ?? '—';
}

function getBudgetId(budget: DealSummary): string | null {
  const idCandidates = [budget.dealId, budget.deal_id]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length);

  if (idCandidates.length) return idCandidates[0];
  return null;
}

/** Normaliza mínimamente un item del backend a DealSummary (lo justo para la tabla) */
function normalizeRowMinimal(row: any) {
  const dealId =
    toStringValue(row?.deal_id) ??
    toStringValue(row?.dealId) ??
    (row?.id != null ? String(row.id) : '');

  return {
    // IDs en ambos formatos
    dealId: dealId || '',
    deal_id: dealId || '',

    dealNumericId: Number.isFinite(Number(dealId)) ? Number(dealId) : null,
    title: toStringValue(row?.title ?? row?.deal_title) ?? '—',
    sede_label: toStringValue(row?.sede_label) ?? null,
    pipeline_id: toStringValue(row?.pipeline_id) ?? null,
    training_address: toStringValue(row?.training_address) ?? null, // schema vigente
    hours: typeof row?.hours === 'number' ? row.hours : Number(row?.hours) || null,
    alumnos: typeof row?.alumnos === 'number' ? row.alumnos : Number(row?.alumnos) || null,
    caes_label: toStringValue(row?.caes_label) ?? null,
    fundae_label: toStringValue(row?.fundae_label) ?? null,
    hotel_label: toStringValue(row?.hotel_label) ?? null,
    organization: row?.organization ?? null,
    person: row?.person ?? null,
    // productos si vinieran
    products: Array.isArray(row?.deal_products)
      ? row.deal_products
      : Array.isArray(row?.products)
      ? row.products
      : undefined,
    productNames: Array.isArray(row?.productNames) ? row.productNames : undefined,
  } as DealSummary;
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
  hasActiveFilters = false,
  onClearFilters,
}: BudgetTableProps) {
  const [fallbackLoading, setFallbackLoading] = useState(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const [fallbackBudgets, setFallbackBudgets] = useState<DealSummary[] | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const effectiveBudgets: DealSummary[] = useMemo(() => {
    if (fallbackBudgets && fallbackBudgets.length) return fallbackBudgets;
    return budgets;
  }, [budgets, fallbackBudgets]);

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
      case 'sede':
        return getSedeLabel(budget);
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

  useEffect(() => {
    if (!isLoading && !error && budgets.length === 0 && !fallbackBudgets && !fallbackLoading) {
      (async () => {
        try {
          setFallbackLoading(true);
          setFallbackError(null);

          // ← usar la API común para respetar API_BASE y shape
          const rows = await fetchDealsWithoutSessions();
          setFallbackBudgets(rows.map(normalizeRowMinimal));
        } catch (e: any) {
          setFallbackError(e?.message || 'Fallo al cargar datos de respaldo');
        } finally {
          setFallbackLoading(false);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, error, budgets.length]);

  if (isLoading) {
    return (
      <div className="text-center py-5 text-muted bg-white rounded-4 shadow-sm">
        <Spinner animation="border" role="status" className="mb-3" />
        <p className="mb-0">Cargando presupuestos desde la base de datos…</p>
      </div>
    );
  }

  if (error) {
    const message =
      error instanceof Error
        ? error.message
        : (error as any)?.message || 'No se pudo cargar el listado de presupuestos.';
    return (
      <Alert variant="danger" className="rounded-4 shadow-sm d-flex flex-column flex-md-row align-items-md-center gap-3">
        <div className="flex-grow-1">
          <p className="fw-semibold mb-1">Error al cargar presupuestos</p>
          <p className="mb-0 small">{message}</p>
        </div>
        <div>
          <Button variant="outline-danger" onClick={onRetry}>
            Reintentar
          </Button>
        </div>
      </Alert>
    );
  }

  if (fallbackLoading) {
    return (
      <div className="text-center py-5 text-muted bg-white rounded-4 shadow-sm">
        <Spinner animation="border" role="status" className="mb-3" />
        <p className="mb-0">Cargando datos de respaldo…</p>
      </div>
    );
  }

  if (fallbackError) {
    return (
      <Alert variant="warning" className="rounded-4 shadow-sm">
        <div className="d-flex justify-content-between align-items-center">
          <div>
            <div className="fw-semibold">No se pudieron recuperar datos de respaldo</div>
            <div className="small mb-0">{fallbackError}</div>
          </div>
          <Button size="sm" variant="outline-secondary" onClick={onRetry}>
            Reintentar
          </Button>
        </div>
      </Alert>
    );
  }

  if (!effectiveBudgets.length) {
    if (hasActiveFilters) {
      return (
        <div className="text-center py-5 text-muted bg-white rounded-4 shadow-sm">
          <p className="mb-1 fw-semibold">No se encontraron presupuestos que coincidan con los filtros.</p>
          <p className="mb-0 small">Ajusta los criterios o limpia los filtros para ver más resultados.</p>
          <div className="mt-3 d-flex justify-content-center gap-2 flex-wrap">
            {typeof onClearFilters === 'function' && (
              <Button size="sm" variant="outline-primary" onClick={onClearFilters}>
                Limpiar filtros
              </Button>
            )}
            <Button size="sm" variant="outline-secondary" onClick={onRetry}>
              Reintentar
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="text-center py-5 text-muted bg-white rounded-4 shadow-sm">
        <p className="mb-1 fw-semibold">No hay presupuestos sin sesiones pendientes.</p>
        <p className="mb-0 small">Importa un presupuesto para comenzar a planificar la formación.</p>
        <div className="mt-3">
          <Button size="sm" variant="outline-secondary" onClick={onRetry}>
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="table-responsive rounded-4 shadow-sm bg-white">
      {isFetching && (
        <div className="d-flex align-items-center gap-2 px-3 py-2 border-bottom text-muted small">
          <Spinner animation="border" size="sm" />
          <span>Actualizando listado…</span>
        </div>
      )}
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
              columnKey="sede"
              label="Sede"
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
            const sedeLabel = getSedeLabel(budget);

            const rowKey = id ?? `${organizationLabel}-${titleLabel}-${index}`;

            return (
              <tr key={rowKey} role="button" onClick={() => onSelect(budget)}>
                <td className="fw-semibold" title={presupuestoTitle}>
                  {presupuestoLabel}
                </td>
                <td>{organizationLabel}</td>
                <td title={budget.title ?? ''}>{titleLabel}</td>
                <td title={names.join(', ')}>{productLabel}</td>
                <td>{sedeLabel}</td>
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
