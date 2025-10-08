import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Spinner, Table } from 'react-bootstrap';
import type { DealSummary } from '../../types/deal';
import { fetchDealsWithoutSessions } from './api'; // ← usar API común
import { formatSedeLabel } from './formatSedeLabel';

interface BudgetTableProps {
  budgets: DealSummary[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  onSelect: (budget: DealSummary) => void;
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
  onSelect
}: BudgetTableProps) {
  const [fallbackLoading, setFallbackLoading] = useState(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const [fallbackBudgets, setFallbackBudgets] = useState<DealSummary[] | null>(null);

  const effectiveBudgets: DealSummary[] = useMemo(() => {
    if (fallbackBudgets && fallbackBudgets.length) return fallbackBudgets;
    return budgets;
  }, [budgets, fallbackBudgets]);

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
            <th scope="col" style={{ width: 160 }}>Presupuesto</th>
            <th scope="col">Empresa</th>
            <th scope="col">Título</th>
            <th scope="col">Formación</th>
            <th scope="col" style={{ width: 140 }}>Sede</th>
          </tr>
        </thead>
        <tbody>
          {effectiveBudgets.map((budget, index) => {
            const names = getProductNames(budget);
            const { label: productLabel } = getProductLabel(budget);

            const id = toStringValue(budget.dealId);
            const presupuestoLabel = id ? `#${id}` : '—';
            const presupuestoTitle = budget.title && budget.title !== presupuestoLabel ? budget.title : undefined;
            const organizationLabel = safeTrim(budget.organization?.name ?? '') ?? '—';
            const titleLabel = safeTrim(budget.title ?? '') ?? '—';
            const sedeLabel = safeTrim(formatSedeLabel(budget.sede_label) ?? '') ?? '—';

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
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
