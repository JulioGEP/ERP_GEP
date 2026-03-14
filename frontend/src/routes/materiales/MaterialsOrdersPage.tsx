import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Col, Modal, Row, Spinner, Table } from 'react-bootstrap';
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
  onSelectBudget?: (budget: DealSummary) => void;
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
  onSelectBudget,
}: MaterialsOrdersPageProps) {
  const [selectedOrder, setSelectedOrder] = useState<MaterialOrder | null>(null);
  const hasError = !!error;
  const hasOrders = orders.length > 0;
  const budgetsById = useMemo(() => buildBudgetLookup(budgets), [budgets]);

  const handleOpenOrder = (order: MaterialOrder) => {
    setSelectedOrder(order);
    onSelect?.(order);
  };

  const handleOpenBudget = (budgetId: string) => {
    const budget = budgetsById.get(budgetId);
    if (!budget) return;
    onSelectBudget?.(budget);
  };

  const selectedOrderEstimatedDelivery = selectedOrder
    ? getOrderEstimatedDelivery(selectedOrder, budgetsById)
    : '—';

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
                      onClick={() => handleOpenOrder(order)}
                      style={{ cursor: 'pointer' }}
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

      <Modal
        show={Boolean(selectedOrder)}
        onHide={() => setSelectedOrder(null)}
        size="lg"
        centered
        contentClassName="erp-modal-content"
      >
        <Modal.Header className="erp-modal-header border-0 pb-0">
          <Modal.Title as="div" className="erp-modal-header-main">
            <div className="erp-modal-title text-truncate">Detalle pedido de materiales</div>
            <div className="erp-modal-subtitle text-truncate">
              {selectedOrder?.orderNumber ? `Pedido #${selectedOrder.orderNumber}` : 'Pedido sin número'}
            </div>
          </Modal.Title>
          <div className="erp-modal-header-actions">
            <Button variant="outline-light" size="sm" className="erp-modal-action" onClick={() => setSelectedOrder(null)}>
              Cerrar
            </Button>
          </div>
        </Modal.Header>
        <Modal.Body className="erp-modal-body">
          {selectedOrder ? (
            <div className="d-grid gap-4">
              <Row className="erp-summary-row g-3">
                <Col md={4}>
                  <label className="form-label">Número de pedido</label>
                  <input className="form-control" readOnly value={selectedOrder.orderNumber ? `#${selectedOrder.orderNumber}` : '—'} />
                </Col>
                <Col md={4}>
                  <label className="form-label">Usuario que realizó el pedido</label>
                  <input className="form-control" readOnly value={selectedOrder.sentFrom?.trim() || '—'} />
                </Col>
                <Col md={4}>
                  <label className="form-label">Proveedor</label>
                  <input className="form-control" readOnly value={selectedOrder.supplierName ?? selectedOrder.supplierEmail ?? '—'} />
                </Col>
                <Col md={6}>
                  <label className="form-label">Fecha de realización del pedido</label>
                  <input className="form-control" readOnly value={formatOrderDate(selectedOrder.createdAt)} />
                </Col>
                <Col md={6}>
                  <label className="form-label">Fecha estimada de entrega</label>
                  <input className="form-control" readOnly value={selectedOrderEstimatedDelivery} />
                </Col>
              </Row>

              <section className="d-grid gap-2">
                <h2 className="h6 fw-semibold mb-0">Productos y cantidades</h2>
                {!selectedOrder.products.items.length ? (
                  <p className="text-muted mb-0">No hay productos asociados al pedido.</p>
                ) : (
                  <Table size="sm" bordered responsive className="mb-0 align-middle">
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th className="text-end">Cantidad proveedor</th>
                        <th className="text-end">Cantidad stock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOrder.products.items.map((item, index) => (
                        <tr key={`${item.productName}-${index}`}>
                          <td>{item.productName || '—'}</td>
                          <td className="text-end">{item.supplierQuantity}</td>
                          <td className="text-end">{item.stockQuantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </section>

              <section className="d-grid gap-2">
                <h2 className="h6 fw-semibold mb-0">Presupuestos relacionados</h2>
                {!selectedOrder.sourceBudgetIds?.length ? (
                  <p className="text-muted mb-0">No hay presupuestos asociados.</p>
                ) : (
                  <div className="d-flex gap-2 flex-wrap">
                    {selectedOrder.sourceBudgetIds.map((budgetId) => {
                      const budget = budgetsById.get(budgetId);
                      return (
                        <Badge
                          key={budgetId}
                          as="button"
                          bg="light"
                          text="dark"
                          className="border px-3 py-2"
                          onClick={() => handleOpenBudget(budgetId)}
                          style={{ cursor: budget ? 'pointer' : 'not-allowed' }}
                        >
                          #{budgetId}
                        </Badge>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </Modal.Body>
      </Modal>
    </div>
  );
}

export default MaterialsOrdersPage;
