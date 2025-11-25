import { useMemo, useState } from 'react';
import { Alert, Button, Spinner, Table } from 'react-bootstrap';
import type { DealProduct, DealSummary } from '../../types/deal';
import { isMaterialPipeline } from './MaterialsBudgetsPage';

export type MaterialsPendingProductsPageProps = {
  budgets: DealSummary[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  onSelect: (budget: DealSummary) => void;
  onOpenImportModal: () => void;
  isImporting: boolean;
  canImport: boolean;
};

type PendingProductRow = {
  key: string;
  budget: DealSummary;
  budgetId: string | null;
  organizationName: string;
  productName: string;
  productGroupKey: string | null;
  quantityLabel: string;
  quantityValue: number | null;
  stockLabel: string;
  stockValue: number | null;
  supplier: string;
  estimatedDelivery: string;
  estimatedDeliveryValue: number | null;
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

function getProductGroupKey(product: DealProduct | null | undefined): string | null {
  const id = product?.id?.trim?.();
  if (id) return `id:${id}`;

  const code = product?.code?.trim().toLowerCase();
  if (code) return `code:${code}`;

  const name = product?.name?.trim().toLowerCase();
  if (name) return `name:${name}`;

  return null;
}

function formatQuantity(quantity: number | string | null | undefined): string {
  if (quantity === null || quantity === undefined) return '—';
  const numericQuantity = typeof quantity === 'string' ? Number(quantity) : quantity;
  if (!Number.isFinite(numericQuantity)) return '—';
  return new Intl.NumberFormat('es-ES').format(numericQuantity);
}

function getQuantityValue(quantity: number | string | null | undefined): number | null {
  if (quantity === null || quantity === undefined) return null;
  const numericQuantity = typeof quantity === 'string' ? Number(quantity) : quantity;
  return Number.isFinite(numericQuantity) ? numericQuantity : null;
}

function getStockValue(stock: number | string | null | undefined): number | null {
  if (stock === null || stock === undefined) return null;
  const numericStock = typeof stock === 'string' ? Number(stock) : stock;
  return Number.isFinite(numericStock) ? numericStock : null;
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

function getEstimatedDeliveryTimestamp(dateIso: string | null | undefined): number | null {
  if (!dateIso) return null;
  const parsed = new Date(dateIso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
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
      productGroupKey: getProductGroupKey(product),
      quantityLabel: formatQuantity(product?.quantity),
      quantityValue: getQuantityValue(product?.quantity),
      stockLabel: formatQuantity(product?.almacen_stock),
      stockValue: getStockValue(product?.almacen_stock),
      supplier: getSupplierLabel(budget),
      estimatedDelivery,
      estimatedDeliveryValue: getEstimatedDeliveryTimestamp(getEstimatedDeliveryValue(budget)),
    }));
  });
}

type SortableColumn =
  | 'budgetId'
  | 'organizationName'
  | 'supplier'
  | 'productName'
  | 'quantity'
  | 'stock'
  | 'estimatedDelivery';

type SortDirection = 'asc' | 'desc';

type SortConfig = { key: SortableColumn; direction: SortDirection } | null;

function getSortableValue(row: PendingProductRow, key: SortableColumn): string | number | null {
  switch (key) {
    case 'budgetId':
      return row.budgetId ? row.budgetId.toLowerCase() : null;
    case 'organizationName':
      return row.organizationName.toLowerCase();
    case 'supplier':
      return row.supplier.toLowerCase();
    case 'productName':
      return row.productName.toLowerCase();
    case 'quantity':
      return row.quantityValue;
    case 'stock':
      return row.stockValue;
    case 'estimatedDelivery':
      return row.estimatedDeliveryValue;
    default:
      return null;
  }
}

function compareNullableValues(
  a: string | number | null,
  b: string | number | null,
  direction: SortDirection,
): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;

  const multiplier = direction === 'asc' ? 1 : -1;

  if (typeof a === 'number' && typeof b === 'number') {
    return (a - b) * multiplier;
  }

  return a.toString().localeCompare(b.toString(), 'es', { sensitivity: 'base' }) * multiplier;
}

function getSortIndicator(sortConfig: SortConfig, key: SortableColumn) {
  if (!sortConfig || sortConfig.key !== key) return null;
  return sortConfig.direction === 'asc' ? '▲' : '▼';
}

export function MaterialsPendingProductsPage({
  budgets,
  isLoading,
  isFetching,
  error,
  onRetry,
  onSelect,
  onOpenImportModal,
  isImporting,
  canImport,
}: MaterialsPendingProductsPageProps) {
  const pendingProducts = useMemo(() => buildPendingProducts(budgets), [budgets]);
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const hasError = !!error;
  const hasRows = pendingProducts.length > 0;

  const sortedProducts = useMemo(() => {
    if (!sortConfig) return pendingProducts;

    const { key, direction } = sortConfig;
    const rows = [...pendingProducts];

    rows.sort((a, b) => {
      const valueA = getSortableValue(a, key);
      const valueB = getSortableValue(b, key);

      return compareNullableValues(valueA, valueB, direction);
    });

    return rows;
  }, [pendingProducts, sortConfig]);

  const stockSummaryByProduct = useMemo(() => {
    const summary = new Map<string, { stock: number | null; totalQuantity: number }>();

    pendingProducts.forEach((row) => {
      if (!row.productGroupKey) return;

      const current = summary.get(row.productGroupKey);
      const stock = current?.stock ?? row.stockValue ?? null;
      const totalQuantity = (current?.totalQuantity ?? 0) + (row.quantityValue ?? 0);

      summary.set(row.productGroupKey, { stock, totalQuantity });
    });

    return summary;
  }, [pendingProducts]);

  const getQuantityClassName = (row: PendingProductRow) => {
    if (!row.productGroupKey || row.quantityValue == null) return undefined;

    const summary = stockSummaryByProduct.get(row.productGroupKey);
    if (!summary || summary.stock == null) return undefined;

    return summary.stock >= summary.totalQuantity ? 'text-success' : 'text-danger';
  };

  const handleSort = (key: SortableColumn) => {
    setSortConfig((current) => {
      if (!current || current.key !== key) {
        return { key, direction: 'asc' };
      }

      return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
    });
  };

  return (
    <div className="d-grid gap-4">
      <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div className="d-flex flex-column gap-2">
          <h1 className="h3 fw-bold mb-0">Materiales · Pendientes</h1>
          <p className="text-muted mb-0">Productos de presupuestos del embudo Material</p>
        </div>
        <div className="d-flex align-items-center gap-3">
          {(isLoading || isFetching || isImporting) && <Spinner animation="border" role="status" size="sm" />}
          {canImport && (
            <Button size="lg" onClick={onOpenImportModal} disabled={isImporting}>
              Importar presupuesto
            </Button>
          )}
        </div>
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
                <th scope="col">
                  <button
                    type="button"
                    className="btn btn-link text-body p-0 text-decoration-none d-inline-flex align-items-center gap-1"
                    onClick={() => handleSort('budgetId')}
                  >
                    Presupuesto {getSortIndicator(sortConfig, 'budgetId')}
                  </button>
                </th>
                <th scope="col">
                  <button
                    type="button"
                    className="btn btn-link text-body p-0 text-decoration-none d-inline-flex align-items-center gap-1"
                    onClick={() => handleSort('organizationName')}
                  >
                    Empresa {getSortIndicator(sortConfig, 'organizationName')}
                  </button>
                </th>
                <th scope="col">
                  <button
                    type="button"
                    className="btn btn-link text-body p-0 text-decoration-none d-inline-flex align-items-center gap-1"
                    onClick={() => handleSort('supplier')}
                  >
                    Proveedor {getSortIndicator(sortConfig, 'supplier')}
                  </button>
                </th>
                <th scope="col">
                  <button
                    type="button"
                    className="btn btn-link text-body p-0 text-decoration-none d-inline-flex align-items-center gap-1"
                    onClick={() => handleSort('productName')}
                  >
                    Producto {getSortIndicator(sortConfig, 'productName')}
                  </button>
                </th>
                <th scope="col">
                  <button
                    type="button"
                    className="btn btn-link text-body p-0 text-decoration-none d-inline-flex align-items-center gap-1"
                    onClick={() => handleSort('stock')}
                  >
                    Stock {getSortIndicator(sortConfig, 'stock')}
                  </button>
                </th>
                <th scope="col">
                  <button
                    type="button"
                    className="btn btn-link text-body p-0 text-decoration-none d-inline-flex align-items-center gap-1"
                    onClick={() => handleSort('quantity')}
                  >
                    Cantidad {getSortIndicator(sortConfig, 'quantity')}
                  </button>
                </th>
                <th scope="col">
                  <button
                    type="button"
                    className="btn btn-link text-body p-0 text-decoration-none d-inline-flex align-items-center gap-1"
                    onClick={() => handleSort('estimatedDelivery')}
                  >
                    Entrega {getSortIndicator(sortConfig, 'estimatedDelivery')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="text-center py-4">
                    <Spinner animation="border" role="status" />
                  </td>
                </tr>
              ) : !hasRows ? (
                <tr>
                  <td colSpan={7} className="text-center py-4 text-muted">
                    No hay productos pendientes del embudo Material.
                  </td>
                </tr>
              ) : (
                sortedProducts.map((row, index) => (
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
                    <td>{row.stockLabel}</td>
                    <td className={getQuantityClassName(row)}>{row.quantityLabel}</td>
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
