import { Alert, Spinner, Table } from 'react-bootstrap';
import type { MaterialOrder } from '../../types/materialOrder';
import type { DealSummary } from '../../types/deal';

export type MaterialsOrdersPageProps = {
  orders: MaterialOrder[];
  budgets: DealSummary[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  onSelect?: (order: MaterialOrder) => void;
};

function formatOrderDate(dateIso: string | null | undefined): string {
  if (!dateIso) return '—';
  const parsed = new Date(dateIso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('es-ES');
}

function getEstimatedDeliveryValue(budget: DealSummary): string | null | undefined {
  return (
    budget.fecha_estimada_entrega_material ??
    (budget as DealSummary & { fecha_estimada_entrega?: string | null }).fecha_estimada_entrega
  );
}

function buildBudgetLookup(budgets: DealSummary[]): Map<string, DealSummary> {
  const map = new Map<string, DealSummary>();

  budgets.forEach((budget) => {
    const dealId = String(budget.deal_id ?? budget.dealId ?? '').trim();
    if (dealId) {
      map.set(dealId, budget);
    }
  });

  return map;
}

function getOrderBudgetLabel(order: MaterialOrder): string {
  if (!order.sourceBudgetIds?.length) return '—';
  return order.sourceBudgetIds.map((id) => `#${id}`).join(', ');
}

function getOrderOrganizationLabel(order: MaterialOrder, budgetsById: Map<string, DealSummary>): string {
  if (!order.sourceBudgetIds?.length) return '—';

  const organizations = Array.from(
    new Set(
      order.sourceBudgetIds
        .map((id) => budgetsById.get(id)?.organization?.name?.trim() ?? '')
        .filter((name) => name.length > 0),
    ),
  );

  return organizations.length ? organizations.join(', ') : '—';
}

function getOrderEstimatedDelivery(order: MaterialOrder, budgetsById: Map<string, DealSummary>): string {
  if (!order.sourceBudgetIds?.length) return '—';

  const firstDelivery = order.sourceBudgetIds
    .map((id) => budgetsById.get(id))
    .map((budget) => (budget ? getEstimatedDeliveryValue(budget) : null))
    .find((value) => Boolean(value));

  return formatOrderDate(firstDelivery);
}

export function MaterialsOrdersPage({
  orders,
  budgets,
  isLoading,
  isFetching,
  error,
  onRetry,
  onSelect,
}: MaterialsOrdersPageProps) {
  const hasError = !!error;
  const hasOrders = orders.length > 0;
  const budgetsById = buildBudgetLookup(budgets);

  return (
    <div className="d-grid gap-4">
      <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div className="d-flex flex-column gap-2">
          <h1 className="h3 fw-bold mb-0">Materiales · Pedidos</h1>
          <p className="text-muted mb-0">Consulta los pedidos realizados y sus proveedores.</p>
        </div>
        {(isLoading || isFetching) && <Spinner animation="border" role="status" size="sm" />}
      </section>

      {hasError ? (
        <Alert variant="danger" className="mb-0">
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
            <div>
              <h2 className="h6 mb-1">Error al cargar los pedidos</h2>
              <p className="mb-0">No se pudieron obtener los pedidos. Inténtalo de nuevo.</p>
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
                <th scope="col">Número de pedido</th>
                <th scope="col">Proveedor</th>
                <th scope="col">Fecha de realización</th>
                <th scope="col">Organización</th>
                <th scope="col">Presupuesto</th>
                <th scope="col">Fecha estimada entrega</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="text-center py-4">
                    <Spinner animation="border" role="status" />
                  </td>
                </tr>
              ) : !hasOrders ? (
                <tr>
                  <td colSpan={6} className="text-center py-4 text-muted">
                    No hay pedidos de materiales para mostrar.
                  </td>
                </tr>
              ) : (
                orders.map((order, index) => {
                  const rowKey = order.id ?? `material-order-${index}`;
                  return (
                    <tr
                      key={rowKey}
                      role={onSelect ? 'button' : undefined}
                      className="align-middle"
                      onClick={onSelect ? () => onSelect(order) : undefined}
                      style={onSelect ? { cursor: 'pointer' } : undefined}
                    >
                      <td className="fw-semibold">{order.orderNumber ? `#${order.orderNumber}` : '—'}</td>
                      <td>{order.supplierName ?? order.supplierEmail ?? '—'}</td>
                      <td>{formatOrderDate(order.createdAt)}</td>
                      <td>{getOrderOrganizationLabel(order, budgetsById)}</td>
                      <td>{getOrderBudgetLabel(order)}</td>
                      <td>{getOrderEstimatedDelivery(order, budgetsById)}</td>
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

export default MaterialsOrdersPage;
