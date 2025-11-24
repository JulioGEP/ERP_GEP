import { useMemo } from 'react';
import { Alert, Spinner, Table } from 'react-bootstrap';
import type { DealProduct, DealSummary } from '../../types/deal';
import { isMaterialPipeline } from './MaterialsBudgetsPage';

export type MaterialsPendingProductsPageProps = {
  budgets: DealSummary[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  onSelect: (budget: DealSummary) => void;
};

type PendingProductRow = {
  key: string;
  budget: DealSummary;
  budgetId: string | null;
  organizationName: string;
  productName: string;
  quantityLabel: string;
  supplier: string;
  estimatedDelivery: string;
};

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

function getProductName(product: DealProduct | null | undefined): string {
  const name = product?.name?.trim();
  if (name) return name;
  const code = product?.code?.trim();
  if (code) return code;
  return '—';
}

function formatQuantity(quantity: number | string | null | undefined): string {
  if (quantity === null || quantity === undefined) return '—';
  const numericQuantity = typeof quantity === 'string' ? Number(quantity) : quantity;
  if (!Number.isFinite(numericQuantity)) return '—';
  return new Intl.NumberFormat('es-ES').format(numericQuantity);
}

function getSupplierLabel(budget: DealSummary): string {
  const supplier = budget.proveedor ?? budget.proveedores;
  const cleaned = supplier?.trim();
  return cleaned && cleaned.length > 0 ? cleaned : '—';
}

function getEstimatedDeliveryValue(budget: DealSummary): string | null | undefined {
  return (
    budget.fecha_estimada_entrega_material ??
    // Compatibilidad con posibles campos sin sufijo
    (budget as DealSummary & { fecha_estimada_entrega?: string | null }).fecha_estimada_entrega
  );
}

function formatEstimatedDelivery(dateIso: string | null | undefined): string {
  if (!dateIso) return '—';
  const parsed = new Date(dateIso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('es-ES');
}

function isShippingExpense(product: DealProduct | null | undefined): boolean {
  const rawLabel = (product?.name ?? product?.code ?? '').trim();
  if (!rawLabel) return false;

  const normalizedLabel = rawLabel
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  return normalizedLabel.includes('gastos de envio');
}

function buildPendingProducts(budgets: DealSummary[]): PendingProductRow[] {
  const filteredBudgets = budgets.filter((budget) => isMaterialPipeline(budget));

  return filteredBudgets.flatMap((budget, budgetIndex) => {
    const budgetId = getBudgetId(budget);
    const organizationName = getOrganizationName(budget);
    const estimatedDelivery = formatEstimatedDelivery(getEstimatedDeliveryValue(budget));
    const products = (Array.isArray(budget.products) ? budget.products : []).filter(
      (product) => !isShippingExpense(product),
    );

    return products.map((product, productIndex) => ({
      key: product?.id?.trim?.() || `${budgetId ?? 'budget'}-product-${budgetIndex}-${productIndex}`,
      budget,
      budgetId,
      organizationName,
      productName: getProductName(product),
      quantityLabel: formatQuantity(product?.quantity),
      supplier: getSupplierLabel(budget),
      estimatedDelivery,
    }));
  });
}

export function MaterialsPendingProductsPage({
  budgets,
  isLoading,
  isFetching,
  error,
  onRetry,
  onSelect,
}: MaterialsPendingProductsPageProps) {
  const pendingProducts = useMemo(() => buildPendingProducts(budgets), [budgets]);
  const hasError = !!error;
  const hasRows = pendingProducts.length > 0;

  return (
    <div className="d-grid gap-4">
      <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div className="d-flex flex-column gap-2">
          <h1 className="h3 fw-bold mb-0">Materiales · Pendientes</h1>
          <p className="text-muted mb-0">Productos de presupuestos del embudo Material</p>
        </div>
        {(isLoading || isFetching) && <Spinner animation="border" role="status" size="sm" />}
      </section>

      {hasError ? (
        <Alert variant="danger" className="mb-0">
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
            <div>
              <h2 className="h6 mb-1">Error al cargar los productos pendientes</h2>
              <p className="mb-0">No se pudieron obtener los productos. Inténtalo de nuevo.</p>
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
                <th scope="col">Proveedor</th>
                <th scope="col">Producto</th>
                <th scope="col">Cantidad</th>
                <th scope="col">Entrega</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="text-center py-4">
                    <Spinner animation="border" role="status" />
                  </td>
                </tr>
              ) : !hasRows ? (
                <tr>
                  <td colSpan={6} className="text-center py-4 text-muted">
                    No hay productos pendientes del embudo Material.
                  </td>
                </tr>
              ) : (
                pendingProducts.map((row, index) => (
                  <tr
                    key={row.key || `pending-product-${index}`}
                    role="button"
                    className="align-middle"
                    onClick={() => onSelect(row.budget)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="fw-semibold">{row.budgetId ? `#${row.budgetId}` : '—'}</td>
                    <td>{row.organizationName}</td>
                    <td>{row.supplier}</td>
                    <td>{row.productName}</td>
                    <td>{row.quantityLabel}</td>
                    <td>{row.estimatedDelivery}</td>
                  </tr>
                ))
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

export default MaterialsPendingProductsPage;
