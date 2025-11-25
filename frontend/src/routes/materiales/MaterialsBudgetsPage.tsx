import { useMemo } from 'react';
import { Alert, Spinner, Table } from 'react-bootstrap';
import type { DealSummary } from '../../types/deal';

export type MaterialsBudgetsPageProps = {
  budgets: DealSummary[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  onSelect: (budget: DealSummary) => void;
};

function normalizePipelineKey(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getBudgetId(budget: DealSummary): string | null {
  const fallbackId = budget.dealId ?? budget.deal_id;
  if (fallbackId == null) return null;
  const trimmed = String(fallbackId).trim();
  return trimmed.length ? trimmed : null;
}

function getOrganizationName(budget: DealSummary): string {
  const name = budget.organization?.name ?? '';
  return name.trim().length ? name : '—';
}

function getProductNames(budget: DealSummary): string {
  const names = budget.productNames ?? budget.products?.map((product) => product?.name ?? '') ?? [];
  const cleaned = names.map((value) => value?.trim()).filter(Boolean) as string[];
  if (!cleaned.length) return '—';
  if (cleaned.length === 1) return cleaned[0];
  return `${cleaned[0]} (+${cleaned.length - 1})`;
}

function formatEstimatedDelivery(dateIso: string | null | undefined): string {
  if (!dateIso) return '—';
  const parsed = new Date(dateIso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('es-ES');
}

export const MATERIAL_PIPELINE_KEYS = new Set(['materiales', 'material']);

function isMaterialPipelineKey(value: unknown): boolean {
  const normalized = normalizePipelineKey(value);
  if (!normalized) return false;
  return MATERIAL_PIPELINE_KEYS.has(normalized) || normalized.includes('material');
}

export function isMaterialPipeline(budget: DealSummary): boolean {
  return isMaterialPipelineKey(budget.pipeline_label) || isMaterialPipelineKey(budget.pipeline_id);
}

function filterMaterialsBudgets(budgets: DealSummary[]): DealSummary[] {
  return budgets.filter((budget) => isMaterialPipeline(budget));
}

export function MaterialsBudgetsPage({
  budgets,
  isLoading,
  isFetching,
  error,
  onRetry,
  onSelect,
}: MaterialsBudgetsPageProps) {
  const materialsBudgets = useMemo(() => filterMaterialsBudgets(budgets), [budgets]);
  const hasError = !!error;

  return (
    <div className="d-grid gap-4">
      <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div className="d-flex flex-column gap-2">
          <h1 className="h3 fw-bold mb-0">Materiales · Todos</h1>
          <p className="text-muted mb-0">Presupuestos del embudo Materiales</p>
        </div>
        {(isLoading || isFetching) && <Spinner animation="border" role="status" size="sm" />}
      </section>

      {hasError ? (
        <Alert variant="danger" className="mb-0">
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
            <div>
              <h2 className="h6 mb-1">Error al cargar los presupuestos de materiales</h2>
              <p className="mb-0">No se pudieron obtener los presupuestos. Inténtalo de nuevo.</p>
            </div>
            <button className="btn btn-outline-danger" onClick={onRetry} type="button">
              Reintentar
            </button>
          </div>
        </Alert>
      ) : null}

      <div className="bg-white rounded-3 shadow-sm border">
        <div className="table-responsive">
          <Table hover className="mb-0">
            <thead>
              <tr>
                <th scope="col">Presupuesto</th>
                <th scope="col">Empresa</th>
                <th scope="col">Producto</th>
                <th scope="col">Proveedores</th>
                <th scope="col">Entrega</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="text-center py-4">
                    <Spinner animation="border" role="status" />
                  </td>
                </tr>
              ) : materialsBudgets.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-4 text-muted">
                    No hay presupuestos del embudo Materiales.
                  </td>
                </tr>
              ) : (
                materialsBudgets.map((budget, index) => {
                  const budgetId = getBudgetId(budget);
                  const rowKey = budgetId ?? budget.deal_id ?? budget.dealId ?? `material-${index}`;
                  return (
                    <tr
                      key={rowKey}
                      role="button"
                      className="align-middle"
                      onClick={() => onSelect(budget)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td className="fw-semibold">{budgetId ? `#${budgetId}` : '—'}</td>
                      <td>{getOrganizationName(budget)}</td>
                      <td>{getProductNames(budget)}</td>
                      <td>{budget.proveedores?.trim() || '—'}</td>
                      <td>{formatEstimatedDelivery(budget.fecha_estimada_entrega_material)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </Table>
        </div>
        {isFetching && !isLoading ? (
          <div className="d-flex align-items-center gap-2 px-3 py-2 border-top text-muted small">
            <Spinner animation="border" role="status" size="sm" />
            <span>Actualizando listado…</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default MaterialsBudgetsPage;
