import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Modal, Spinner } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DealSummary, MaterialDealStatus } from '../../types/deal';
import { MATERIAL_DEAL_STATUSES } from '../../types/deal';
import type { MaterialOrder } from '../../types/materialOrder';
import { patchDealEditable } from '../../features/presupuestos/api/deals.api';
import { DEALS_ALL_QUERY_KEY } from '../../features/presupuestos/queryKeys';
import { isMaterialPipeline } from './MaterialsBudgetsPage';

export type MaterialsBoardPageProps = {
  budgets: DealSummary[];
  orders?: MaterialOrder[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  onSelect: (budget: DealSummary) => void;
};

function normalizeStatus(value: unknown): MaterialDealStatus | null {
  let text: string | null = null;
  if (typeof value === 'string') {
    text = value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    text = String(value);
  } else if (value && typeof value === 'object' && 'toString' in value) {
    const candidate = (value as { toString?: () => string }).toString?.();
    text = typeof candidate === 'string' ? candidate : null;
  }

  if (!text) return null;
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  for (const status of MATERIAL_DEAL_STATUSES) {
    const normalizedStatus = status
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (normalizedStatus === normalized) {
      return status;
    }
  }

  return null;
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

function resolveStatus(budget: DealSummary): MaterialDealStatus {
  return normalizeStatus(budget.estado_material) ?? 'Pedidos confirmados';
}

function normalizeProductName(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isShippingExpense(productName: string | null | undefined): boolean {
  return normalizeProductName(productName).includes('gastos de envio');
}

function buildOrderedProductKeys(orders: MaterialOrder[]): Set<string> {
  const orderedKeys = new Set<string>();

  for (const order of orders) {
    const sourceBudgetIds = Array.isArray(order.sourceBudgetIds) ? order.sourceBudgetIds : [];
    const orderItems = Array.isArray(order.products?.items) ? order.products.items : [];

    for (const budgetId of sourceBudgetIds) {
      const normalizedBudgetId = String(budgetId ?? '').trim();
      if (!normalizedBudgetId) continue;

      for (const item of orderItems) {
        const normalizedProductName = normalizeProductName(item?.productName);
        if (!normalizedProductName) continue;
        orderedKeys.add(`${normalizedBudgetId}::${normalizedProductName}`);
      }
    }
  }

  return orderedKeys;
}

function hasPendingProductsInOrder(budget: DealSummary, orderedProductKeys: Set<string>): boolean {
  const budgetId = getBudgetId(budget);
  if (!budgetId) return false;

  const products = (Array.isArray(budget.products) ? budget.products : []).filter((product) => {
    const name = product?.name?.trim() || product?.code?.trim() || '';
    return !isShippingExpense(name);
  });

  if (products.length <= 1) return false;

  let hasOrderedProduct = false;
  let hasNotOrderedProduct = false;

  for (const product of products) {
    const normalizedProductName = normalizeProductName(product?.name ?? product?.code);
    if (!normalizedProductName) {
      hasNotOrderedProduct = true;
      continue;
    }

    if (orderedProductKeys.has(`${budgetId}::${normalizedProductName}`)) {
      hasOrderedProduct = true;
    } else {
      hasNotOrderedProduct = true;
    }

    if (hasOrderedProduct && hasNotOrderedProduct) return true;
  }

  return false;
}

function hasAllProductsInOrder(budget: DealSummary, orderedProductKeys: Set<string>): boolean {
  const budgetId = getBudgetId(budget);
  if (!budgetId) return false;

  const products = (Array.isArray(budget.products) ? budget.products : []).filter((product) => {
    const name = product?.name?.trim() || product?.code?.trim() || '';
    return !isShippingExpense(name);
  });

  if (!products.length) return false;

  return products.every((product) => {
    const normalizedProductName = normalizeProductName(product?.name ?? product?.code);
    return normalizedProductName.length
      ? orderedProductKeys.has(`${budgetId}::${normalizedProductName}`)
      : false;
  });
}

function canMoveToStatus(
  budget: DealSummary,
  targetStatus: MaterialDealStatus,
  orderedProductKeys: Set<string>,
): boolean {
  const hasFullOrder = hasAllProductsInOrder(budget, orderedProductKeys);
  if (!hasFullOrder) return true;

  return targetStatus !== 'Pedidos confirmados' && targetStatus !== 'Pendiente compra';
}

function hasAnyAssociatedOrder(budget: DealSummary, orders: MaterialOrder[]): boolean {
  const budgetId = getBudgetId(budget);
  if (!budgetId) return false;

  return orders.some((order) => {
    const sourceBudgetIds = Array.isArray(order.sourceBudgetIds) ? order.sourceBudgetIds : [];
    return sourceBudgetIds.some((sourceBudgetId) => String(sourceBudgetId ?? '').trim() === budgetId);
  });
}

const ARCHIVED_MATERIAL_STATUS: MaterialDealStatus = 'Enviados al cliente';

function isArchivedMaterialBudget(budget: DealSummary): boolean {
  if (resolveStatus(budget) !== ARCHIVED_MATERIAL_STATUS) return false;
  const normalized = String(budget.presu_holded ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'si' || normalized === 'yes';
}

const MAX_VISIBLE_CARDS_PER_COLUMN = 5;
const KANBAN_CARD_ESTIMATED_HEIGHT_REM = 10;
export function MaterialsBoardPage({
  budgets,
  orders = [],
  isLoading,
  isFetching,
  error,
  onRetry,
  onSelect,
}: MaterialsBoardPageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updatingDealId, setUpdatingDealId] = useState<string | null>(null);
  const [pendingOrderPromptBudgetId, setPendingOrderPromptBudgetId] = useState<string | null>(null);

  const requiresOrderStatuses = useMemo(
    () =>
      new Set<MaterialDealStatus>([
        'Pedido a proveedor',
        'Mercancía en tránsito',
        'Recepción almacén',
        'Listos para preparar',
        'Enviados al cliente',
        'Cerrado',
      ]),
    [],
  );

  const materialsBudgets = useMemo(
    () => budgets.filter((budget) => isMaterialPipeline(budget)),
    [budgets],
  );

  const archivedCount = useMemo(
    () => materialsBudgets.filter((budget) => isArchivedMaterialBudget(budget)).length,
    [materialsBudgets],
  );

  const dealsByStatus = useMemo(() => {
    const grouped = new Map<MaterialDealStatus, DealSummary[]>();
    MATERIAL_DEAL_STATUSES.forEach((status) => grouped.set(status, []));
    const orderedProductKeys = buildOrderedProductKeys(orders);
    const mixedOrderStatus: MaterialDealStatus = 'Pedido a medias';

    materialsBudgets.forEach((budget) => {
      if (isArchivedMaterialBudget(budget)) return;
      if (hasPendingProductsInOrder(budget, orderedProductKeys)) {
        grouped.get(mixedOrderStatus)?.push(budget);
        return;
      }
      const status = resolveStatus(budget);
      const bucket = grouped.get(status);
      if (bucket) bucket.push(budget);
    });

    return grouped;
  }, [materialsBudgets, orders]);

  const orderedProductKeys = useMemo(() => buildOrderedProductKeys(orders), [orders]);

  const budgetsById = useMemo(() => {
    const map = new Map<string, DealSummary>();
    materialsBudgets.forEach((budget) => {
      const id = getBudgetId(budget);
      if (id) map.set(id, budget);
    });
    return map;
  }, [materialsBudgets]);

  const updateStatusMutation = useMutation({
    mutationFn: async ({
      dealId,
      status,
    }: {
      dealId: string;
      status: MaterialDealStatus;
    }) => {
      await patchDealEditable(dealId, {
        estado_material: status,
        ...(status === ARCHIVED_MATERIAL_STATUS ? { presu_holded: 'true' } : {}),
      });
      return status;
    },
    onMutate: async ({ dealId, status }) => {
      setUpdateError(null);
      setUpdatingDealId(dealId);
      const previousDeals = queryClient.getQueryData<DealSummary[]>(DEALS_ALL_QUERY_KEY);

      queryClient.setQueryData<DealSummary[]>(DEALS_ALL_QUERY_KEY, (oldDeals = []) =>
        oldDeals.map((deal) =>
          (deal.deal_id ?? deal.dealId) === dealId
            ? {
                ...deal,
                estado_material: status,
                ...(status === ARCHIVED_MATERIAL_STATUS ? { presu_holded: 'true' } : {}),
              }
            : deal,
        ),
      );

      return { previousDeals };
    },
    onError: (mutationError, _variables, context) => {
      setUpdateError('No se pudo actualizar el estado. Inténtalo de nuevo.');
      setUpdatingDealId(null);
      if (context?.previousDeals) {
        queryClient.setQueryData(DEALS_ALL_QUERY_KEY, context.previousDeals);
      }
    },
    onSuccess: (_, variables) => {
      setUpdatingDealId(null);
      queryClient.setQueryData<DealSummary[]>(DEALS_ALL_QUERY_KEY, (oldDeals = []) =>
        oldDeals.map((deal) =>
          (deal.deal_id ?? deal.dealId) === variables.dealId
            ? {
                ...deal,
                estado_material: variables.status,
                ...(variables.status === ARCHIVED_MATERIAL_STATUS ? { presu_holded: 'true' } : {}),
              }
            : deal,
        ),
      );
    },
  });


  useEffect(() => {
    const statusesToPromote = new Set<MaterialDealStatus>([
      'Pedidos confirmados',
      'Pendiente compra',
      'Pedido a medias',
    ]);

    materialsBudgets.forEach((budget) => {
      if (isArchivedMaterialBudget(budget)) return;
      if (!hasAllProductsInOrder(budget, orderedProductKeys)) return;
      const status = resolveStatus(budget);
      if (!statusesToPromote.has(status)) return;
      const budgetId = getBudgetId(budget);
      if (!budgetId || updatingDealId === budgetId) return;
      updateStatusMutation.mutate({ dealId: budgetId, status: 'Pedido a proveedor' });
    });
  }, [materialsBudgets, orderedProductKeys, updateStatusMutation, updatingDealId]);

  const handleStatusChange = (budget: DealSummary, nextStatus: MaterialDealStatus) => {
    const budgetId = budget.deal_id ?? budget.dealId;
    if (!budgetId) return;
    updateStatusMutation.mutate({ dealId: budgetId, status: nextStatus });
  };

  const handleDragStart = (
    event: React.DragEvent<HTMLElement>,
    budget: DealSummary,
    currentStatus: MaterialDealStatus,
  ) => {
    const budgetId = getBudgetId(budget);
    if (!budgetId) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(
      'application/json',
      JSON.stringify({ budgetId, status: currentStatus }),
    );
  };

  const handleDrop = (event: React.DragEvent<HTMLElement>, targetStatus: MaterialDealStatus) => {
    event.preventDefault();
    const payload = event.dataTransfer.getData('application/json');
    if (!payload) return;

    try {
      const data = JSON.parse(payload) as { budgetId?: string; status?: MaterialDealStatus };
      if (!data?.budgetId) return;
      const budget = budgetsById.get(data.budgetId);
      if (!budget) return;
      const currentStatus = resolveStatus(budget);
      if (currentStatus === targetStatus) return;
      if (targetStatus === 'Pedido a medias') {
        setUpdateError('No puedes mover manualmente un presupuesto a "Pedido a medias".');
        return;
      }
      if (requiresOrderStatuses.has(targetStatus) && !hasAnyAssociatedOrder(budget, orders)) {
        setPendingOrderPromptBudgetId(data.budgetId);
        return;
      }
      if (!canMoveToStatus(budget, targetStatus, orderedProductKeys)) return;
      handleStatusChange(budget, targetStatus);
    } catch (error) {
      console.error('Error handling drop', error);
    }
  };

  const hasError = !!error;
  const isRefreshing = isFetching && !isLoading;

  return (
    <div className="d-grid gap-4">
      <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div className="d-flex flex-column gap-2">
          <h1 className="h3 fw-bold mb-0">Materiales · Tablero</h1>
          <p className="text-muted mb-0">Visualiza y actualiza el estado de los pedidos de materiales.</p>
        </div>
        <div className="d-flex align-items-center gap-3">
          <div className="small text-muted">
            Presupuestos archivados:{' '}
            <Link
              to="/materiales/todos?budgets-table__filter__presu_holded=true"
              className="fw-semibold text-decoration-none"
            >
              {archivedCount}
            </Link>
          </div>
          {(isLoading || isFetching) && <Spinner animation="border" role="status" size="sm" />}
        </div>
      </section>

      {hasError ? (
        <Alert variant="danger" className="mb-0">
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
            <div>
              <h2 className="h6 mb-1">Error al cargar el tablero</h2>
              <p className="mb-0">No se pudieron obtener los presupuestos. Inténtalo de nuevo.</p>
            </div>
            <button className="btn btn-outline-danger" onClick={onRetry} type="button">
              Reintentar
            </button>
          </div>
        </Alert>
      ) : null}

      {updateError ? (
        <Alert variant="warning" className="mb-0">
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
            <span>{updateError}</span>
            <Button
              type="button"
              variant="outline-secondary"
              size="sm"
              onClick={() => setUpdateError(null)}
            >
              Cerrar
            </Button>
          </div>
        </Alert>
      ) : null}

      <div className="d-grid gap-3" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        {MATERIAL_DEAL_STATUSES.slice(0, 4).map((status) => {
          const items = dealsByStatus.get(status) ?? [];
          return (
            <section
              key={status}
              className="bg-white rounded-3 shadow-sm border p-3 d-flex flex-column gap-3"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(event, status)}
            >
              <header className="d-flex align-items-start justify-content-between gap-2">
                <div className="d-flex flex-column">
                  <h2 className="h6 mb-0">{status}</h2>
                </div>
                <Badge bg="secondary" pill>
                  {items.length}
                </Badge>
              </header>

              <div
                className="d-flex flex-column gap-3"
                style={{
                  maxHeight: `calc(${MAX_VISIBLE_CARDS_PER_COLUMN} * ${KANBAN_CARD_ESTIMATED_HEIGHT_REM}rem)`,
                  overflowY: 'auto',
                  paddingRight: '0.25rem',
                }}
              >
                {isLoading ? (
                  <div className="text-center text-muted py-3">
                    <Spinner animation="border" role="status" size="sm" />
                  </div>
                ) : items.length === 0 ? (
                  <p className="text-muted text-center mb-0">No hay presupuestos en este estado.</p>
                ) : (
                  items.map((budget) => {
                    const budgetId = getBudgetId(budget);
                    const estimatedDelivery = formatEstimatedDelivery(budget.fecha_estimada_entrega_material);
                    const isUpdating = updatingDealId === (budget.deal_id ?? budget.dealId);

                    return (
                      <article
                        key={budgetId ?? budget.deal_id ?? budget.dealId ?? budget.title}
                        className="border rounded-3 p-3 d-flex flex-column gap-2"
                        style={{ cursor: 'grab' }}
                        draggable
                        onDragStart={(event) => handleDragStart(event, budget, status)}
                        onDragEnd={(event) => event.dataTransfer?.clearData?.()}
                        onClick={() => onSelect(budget)}
                      >
                        <div className="d-flex align-items-center justify-content-between gap-2">
                          <div className="d-flex flex-column">
                            <span className="fw-semibold">{budgetId ? `#${budgetId}` : budget.title}</span>
                            <small className="text-muted">{getOrganizationName(budget)}</small>
                          </div>
                          {isUpdating && <Spinner animation="border" role="status" size="sm" />}
                        </div>
                        <div className="text-muted small">
                          <div className="mb-1">
                            <span className="fw-semibold text-dark">Producto:</span> {getProductNames(budget)}
                          </div>
                          <div className="mb-1">
                            <span className="fw-semibold text-dark">Proveedores:</span>{' '}
                            {budget.proveedores?.trim() || '—'}
                          </div>
                          <div>
                            <span className="fw-semibold text-dark">Entrega estimada:</span> {estimatedDelivery}
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>

      <div className="d-grid gap-3" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        {MATERIAL_DEAL_STATUSES.slice(4).map((status) => {
          const items = dealsByStatus.get(status) ?? [];
          return (
            <section
              key={status}
              className="bg-white rounded-3 shadow-sm border p-3 d-flex flex-column gap-3"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(event, status)}
            >
              <header className="d-flex align-items-start justify-content-between gap-2">
                <div className="d-flex flex-column">
                  <h2 className="h6 mb-0">{status}</h2>
                </div>
                <Badge bg="secondary" pill>
                  {items.length}
                </Badge>
              </header>

              <div
                className="d-flex flex-column gap-3"
                style={{
                  maxHeight: `calc(${MAX_VISIBLE_CARDS_PER_COLUMN} * ${KANBAN_CARD_ESTIMATED_HEIGHT_REM}rem)`,
                  overflowY: 'auto',
                  paddingRight: '0.25rem',
                }}
              >
                {isLoading ? (
                  <div className="text-center text-muted py-3">
                    <Spinner animation="border" role="status" size="sm" />
                  </div>
                ) : items.length === 0 ? (
                  <p className="text-muted text-center mb-0">No hay presupuestos en este estado.</p>
                ) : (
                  items.map((budget) => {
                    const budgetId = getBudgetId(budget);
                    const estimatedDelivery = formatEstimatedDelivery(budget.fecha_estimada_entrega_material);
                    const isUpdating = updatingDealId === (budget.deal_id ?? budget.dealId);

                    return (
                      <article
                        key={budgetId ?? budget.deal_id ?? budget.dealId ?? budget.title}
                        className="border rounded-3 p-3 d-flex flex-column gap-2"
                        style={{ cursor: 'grab' }}
                        draggable
                        onDragStart={(event) => handleDragStart(event, budget, status)}
                        onDragEnd={(event) => event.dataTransfer?.clearData?.()}
                        onClick={() => onSelect(budget)}
                      >
                        <div className="d-flex align-items-center justify-content-between gap-2">
                          <div className="d-flex flex-column">
                            <span className="fw-semibold">{budgetId ? `#${budgetId}` : budget.title}</span>
                            <small className="text-muted">{getOrganizationName(budget)}</small>
                          </div>
                          {isUpdating && <Spinner animation="border" role="status" size="sm" />}
                        </div>
                        <div className="text-muted small">
                          <div className="mb-1">
                            <span className="fw-semibold text-dark">Producto:</span> {getProductNames(budget)}
                          </div>
                          <div className="mb-1">
                            <span className="fw-semibold text-dark">Proveedores:</span>{' '}
                            {budget.proveedores?.trim() || '—'}
                          </div>
                          <div>
                            <span className="fw-semibold text-dark">Entrega estimada:</span> {estimatedDelivery}
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>

      {isRefreshing ? (
        <div className="d-flex align-items-center gap-2 px-3 py-2 border rounded-3 text-muted small bg-white">
          <Spinner animation="border" role="status" size="sm" />
          <span>Actualizando tablero…</span>
        </div>
      ) : null}

      <Modal
        show={pendingOrderPromptBudgetId !== null}
        onHide={() => setPendingOrderPromptBudgetId(null)}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>Crear pedido</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          No puedes mover un presupuesto a este estado sin hacer el pedido al proveedor, ¿quieres
          crear un pedido?
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setPendingOrderPromptBudgetId(null)}>
            No
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              const budgetId = pendingOrderPromptBudgetId;
              setPendingOrderPromptBudgetId(null);
              if (!budgetId) return;
              navigate(`/materiales/pendientes?budgetId=${encodeURIComponent(budgetId)}`);
            }}
          >
            Sí
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}

export default MaterialsBoardPage;
