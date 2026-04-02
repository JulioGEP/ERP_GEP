import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Accordion, Alert, Badge, Button, Col, Modal, Row, Spinner, Table } from 'react-bootstrap';
import {
  deleteMaterialOrderDocument,
  fetchMaterialOrderDocuments,
  uploadMaterialOrderDocument,
} from '../../features/materials/orders.api';
import type { MaterialOrder, MaterialOrderDocument } from '../../types/materialOrder';
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
  onDelete?: (orderId: number) => void;
  onUpdate?: (payload: { id: number; textoPedido: string | null; pedidoRealizado: boolean; pedidoRecibido: boolean }) => Promise<void> | void;
  deletingOrderId?: number | null;
  updatingOrderId?: number | null;
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

function getNormalizedTextoPedido(textoPedido: string | null | undefined): string | null {
  return textoPedido?.trim() ? textoPedido.trim() : null;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const marker = 'base64,';
      const index = result.indexOf(marker);
      if (index < 0) {
        reject(new Error('No se pudo codificar el archivo.'));
        return;
      }
      resolve(result.slice(index + marker.length));
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
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
  onDelete,
  onUpdate,
  deletingOrderId = null,
  updatingOrderId = null,
}: MaterialsOrdersPageProps) {
  const [selectedOrder, setSelectedOrder] = useState<MaterialOrder | null>(null);
  const [textoPedidoDraft, setTextoPedidoDraft] = useState('');
  const [pedidoRealizadoDraft, setPedidoRealizadoDraft] = useState(false);
  const [pedidoRecibidoDraft, setPedidoRecibidoDraft] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [showReceiveWarning, setShowReceiveWarning] = useState(false);
  const [documentsByOrder, setDocumentsByOrder] = useState<Record<number, MaterialOrderDocument[]>>({});
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [isUploadingDocuments, setIsUploadingDocuments] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const navigate = useNavigate();
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


  useEffect(() => {
    if (!selectedOrder) {
      setTextoPedidoDraft('');
      setPedidoRealizadoDraft(false);
      setPedidoRecibidoDraft(false);
      return;
    }

    setTextoPedidoDraft(selectedOrder.textoPedido ?? '');
    setPedidoRealizadoDraft(Boolean(selectedOrder.pedidoRealizado));
    setPedidoRecibidoDraft(Boolean(selectedOrder.pedidoRecibido));
  }, [selectedOrder]);

  useEffect(() => {
    if (!selectedOrder) {
      setDocumentError(null);
      return;
    }

    const orderId = selectedOrder.id;
    if (documentsByOrder[orderId]) {
      return;
    }

    setIsLoadingDocuments(true);
    setDocumentError(null);

    void fetchMaterialOrderDocuments(orderId)
      .then((response) => {
        setDocumentsByOrder((current) => ({
          ...current,
          [orderId]: response.documents ?? [],
        }));
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'No se pudieron cargar los documentos.';
        setDocumentError(message);
      })
      .finally(() => {
        setIsLoadingDocuments(false);
      });
  }, [documentsByOrder, selectedOrder]);


  const openReceiveWarning = () => {
    setShowReceiveWarning(true);
  };

  const handleTogglePedidoRealizado = async (checked: boolean) => {
    if (!selectedOrder || !onUpdate || isSavingOrder) return;

    const nextPedidoRecibido = checked ? pedidoRecibidoDraft : false;

    setPedidoRealizadoDraft(checked);
    setPedidoRecibidoDraft(nextPedidoRecibido);
    setIsSavingOrder(true);

    try {
      await onUpdate({
        id: selectedOrder.id,
        textoPedido: getNormalizedTextoPedido(textoPedidoDraft),
        pedidoRealizado: checked,
        pedidoRecibido: nextPedidoRecibido,
      });
      setSelectedOrder((current) =>
        current && current.id === selectedOrder.id
          ? { ...current, pedidoRealizado: checked, pedidoRecibido: nextPedidoRecibido }
          : current,
      );
    } finally {
      setIsSavingOrder(false);
    }
  };

  const handleTogglePedidoRecibido = async (checked: boolean) => {
    if (!selectedOrder || !onUpdate || isSavingOrder) return;

    if (checked && !pedidoRealizadoDraft) {
      openReceiveWarning();
      return;
    }

    const nextPedidoRealizado = checked ? true : pedidoRealizadoDraft;

    setPedidoRealizadoDraft(nextPedidoRealizado);
    setPedidoRecibidoDraft(checked);
    setIsSavingOrder(true);

    try {
      await onUpdate({
        id: selectedOrder.id,
        textoPedido: getNormalizedTextoPedido(textoPedidoDraft),
        pedidoRealizado: nextPedidoRealizado,
        pedidoRecibido: checked,
      });
      setSelectedOrder((current) =>
        current && current.id === selectedOrder.id
          ? { ...current, pedidoRealizado: nextPedidoRealizado, pedidoRecibido: checked }
          : current,
      );
    } finally {
      setIsSavingOrder(false);
    }
  };

  const handleTextoPedidoBlur = async () => {
    if (!selectedOrder || !onUpdate || isSavingOrder) return;

    const normalizedTextoPedido = getNormalizedTextoPedido(textoPedidoDraft);
    const currentTextoPedido = selectedOrder.textoPedido?.trim() || null;

    if (
      normalizedTextoPedido === currentTextoPedido &&
      pedidoRealizadoDraft === Boolean(selectedOrder.pedidoRealizado) &&
      pedidoRecibidoDraft === Boolean(selectedOrder.pedidoRecibido)
    ) {
      return;
    }

    setIsSavingOrder(true);

    try {
      await onUpdate({
        id: selectedOrder.id,
        textoPedido: normalizedTextoPedido,
        pedidoRealizado: pedidoRealizadoDraft,
        pedidoRecibido: pedidoRecibidoDraft,
      });
      setSelectedOrder((current) =>
        current && current.id === selectedOrder.id
          ? {
              ...current,
              textoPedido: normalizedTextoPedido,
              pedidoRealizado: pedidoRealizadoDraft,
              pedidoRecibido: pedidoRecibidoDraft,
            }
          : current,
      );
    } finally {
      setIsSavingOrder(false);
    }
  };

  const selectedOrderEstimatedDelivery = selectedOrder
    ? getOrderEstimatedDelivery(selectedOrder, budgetsById)
    : '—';
  const selectedOrderDocuments = selectedOrder ? (documentsByOrder[selectedOrder.id] ?? []) : [];

  const handleUploadDocuments = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!selectedOrder || !files?.length) return;

    setDocumentError(null);
    setIsUploadingDocuments(true);

    try {
      const uploadedDocs: MaterialOrderDocument[] = [];
      for (const file of Array.from(files)) {
        const contentBase64 = await fileToBase64(file);
        const response = await uploadMaterialOrderDocument({
          orderId: selectedOrder.id,
          fileName: file.name,
          mimeType: file.type || null,
          fileSize: file.size,
          contentBase64,
        });
        uploadedDocs.push(response.document);
      }

      setDocumentsByOrder((current) => {
        const existing = current[selectedOrder.id] ?? [];
        return {
          ...current,
          [selectedOrder.id]: [...uploadedDocs, ...existing],
        };
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'No se pudieron subir los documentos.';
      setDocumentError(message);
    } finally {
      setIsUploadingDocuments(false);
      event.target.value = '';
    }
  };

  const handleDeleteDocument = async (documentId: string) => {
    if (!selectedOrder) return;
    const confirmed = window.confirm('¿Eliminar documento?');
    if (!confirmed) return;

    setDeletingDocumentId(documentId);
    setDocumentError(null);

    try {
      await deleteMaterialOrderDocument(documentId);
      setDocumentsByOrder((current) => ({
        ...current,
        [selectedOrder.id]: (current[selectedOrder.id] ?? []).filter((doc) => doc.id !== documentId),
      }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'No se pudo eliminar el documento.';
      setDocumentError(message);
    } finally {
      setDeletingDocumentId(null);
    }
  };

  const handleRowToggleUpdate = async (
    order: MaterialOrder,
    updates: { pedidoRealizado: boolean; pedidoRecibido: boolean },
  ) => {
    if (!onUpdate || updatingOrderId !== null) return;

    if (updates.pedidoRecibido && !updates.pedidoRealizado) {
      openReceiveWarning();
      return;
    }

    await onUpdate({
      id: order.id,
      textoPedido: getNormalizedTextoPedido(order.textoPedido),
      pedidoRealizado: updates.pedidoRealizado,
      pedidoRecibido: updates.pedidoRecibido,
    });
  };

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
                <th scope="col" className="text-end">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="text-center py-4">
                    <Spinner animation="border" role="status" />
                  </td>
                </tr>
              ) : !hasOrders ? (
                <tr>
                  <td colSpan={7} className="text-center py-4 text-muted">
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
                      <td className="text-end" onClick={(event) => event.stopPropagation()}>
                        <div className="d-inline-flex align-items-center gap-3 flex-wrap justify-content-end">
                          <div className="form-check mb-0">
                            <input
                              id={`pedido-realizado-${rowKey}`}
                              className="form-check-input"
                              type="checkbox"
                              checked={Boolean(order.pedidoRealizado)}
                              onChange={(event) => {
                                const nextPedidoRealizado = event.target.checked;
                                const nextPedidoRecibido = nextPedidoRealizado ? Boolean(order.pedidoRecibido) : false;
                                void handleRowToggleUpdate(order, {
                                  pedidoRealizado: nextPedidoRealizado,
                                  pedidoRecibido: nextPedidoRecibido,
                                });
                              }}
                              disabled={updatingOrderId !== null}
                            />
                            <label className="form-check-label small" htmlFor={`pedido-realizado-${rowKey}`}>
                              Realizado
                            </label>
                          </div>
                          <div className="form-check mb-0">
                            <input
                              id={`pedido-recibido-${rowKey}`}
                              className="form-check-input"
                              type="checkbox"
                              checked={Boolean(order.pedidoRecibido)}
                              onChange={(event) => {
                                const nextPedidoRecibido = event.target.checked;
                                void handleRowToggleUpdate(order, {
                                  pedidoRealizado: Boolean(order.pedidoRealizado),
                                  pedidoRecibido: nextPedidoRecibido,
                                });
                              }}
                              disabled={updatingOrderId !== null}
                            />
                            <label className="form-check-label small" htmlFor={`pedido-recibido-${rowKey}`}>
                              Recibido
                            </label>
                          </div>
                          <button
                            type="button"
                            className="btn btn-outline-danger btn-sm"
                            aria-label="Eliminar pedido"
                            title="Eliminar pedido"
                            onClick={() => {
                              if (!order.id || deletingOrderId) return;
                              onDelete?.(order.id);
                            }}
                            disabled={!order.id || Boolean(deletingOrderId)}
                          >
                            {deletingOrderId === order.id ? (
                              <Spinner animation="border" role="status" size="sm" />
                            ) : (
                              <span aria-hidden="true">🗑️</span>
                            )}
                          </button>
                        </div>
                      </td>
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
            <Button
              variant="outline-light"
              size="sm"
              className="erp-modal-action"
              onClick={() => setSelectedOrder(null)}
              disabled={isSavingOrder || (selectedOrder ? updatingOrderId === selectedOrder.id : false)}
            >
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
                <Col md={12}>
                  <label className="form-label">Campo de texto</label>
                  <textarea
                    className="form-control"
                    rows={2}
                    value={textoPedidoDraft}
                    onChange={(event) => setTextoPedidoDraft(event.target.value)}
                    onBlur={handleTextoPedidoBlur}
                    placeholder="—"
                    disabled={isSavingOrder || updatingOrderId === selectedOrder.id}
                  />
                </Col>
                <Col md={6}>
                  <label className="form-label d-block">Pedido realizado</label>
                  <div className="form-check">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      checked={pedidoRealizadoDraft}
                      onChange={(event) => {
                        void handleTogglePedidoRealizado(event.target.checked);
                      }}
                      disabled={isSavingOrder || updatingOrderId === selectedOrder.id}
                    />
                    <label className="form-check-label">Sí</label>
                  </div>
                </Col>
                <Col md={6}>
                  <label className="form-label d-block">Pedido recibido</label>
                  <div className="form-check">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      checked={pedidoRecibidoDraft}
                      onChange={(event) => {
                        void handleTogglePedidoRecibido(event.target.checked);
                      }}
                      disabled={isSavingOrder || updatingOrderId === selectedOrder.id}
                    />
                    <label className="form-check-label">Sí</label>
                  </div>
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

              <Accordion defaultActiveKey="" alwaysOpen={false}>
                <Accordion.Item eventKey="documents">
                  <Accordion.Header>
                    <span className="erp-accordion-title">
                      Documentos
                      {selectedOrderDocuments.length > 0 ? (
                        <span className="erp-accordion-count">{selectedOrderDocuments.length}</span>
                      ) : null}
                    </span>
                  </Accordion.Header>
                  <Accordion.Body>
                    <div className="d-grid gap-3">
                      <div>
                        <label className="btn btn-outline-secondary btn-sm mb-0" htmlFor="material-order-documents-upload">
                          {isUploadingDocuments ? (
                            <>
                              <Spinner animation="border" size="sm" role="status" className="me-2" />
                              Subiendo…
                            </>
                          ) : (
                            'Subir documentos'
                          )}
                        </label>
                        <input
                          id="material-order-documents-upload"
                          type="file"
                          multiple
                          className="d-none"
                          onChange={(event) => {
                            void handleUploadDocuments(event);
                          }}
                          disabled={isUploadingDocuments || !selectedOrder}
                        />
                      </div>

                      {documentError ? <Alert variant="danger" className="mb-0">{documentError}</Alert> : null}

                      {isLoadingDocuments ? (
                        <div className="d-flex align-items-center gap-2 text-muted small">
                          <Spinner animation="border" size="sm" role="status" />
                          Cargando documentos…
                        </div>
                      ) : selectedOrderDocuments.length === 0 ? (
                        <p className="text-muted mb-0">No hay documentos adjuntos.</p>
                      ) : (
                        <div className="d-grid gap-2">
                          {selectedOrderDocuments.map((document) => (
                            <div key={document.id} className="border rounded p-2 d-flex justify-content-between align-items-center gap-3">
                              <a
                                href={document.driveWebViewLink ?? '#'}
                                target="_blank"
                                rel="noreferrer"
                                className="fw-semibold"
                                onClick={(event) => {
                                  if (!document.driveWebViewLink) {
                                    event.preventDefault();
                                  }
                                }}
                              >
                                {document.fileName}
                              </a>
                              <Button
                                variant="outline-danger"
                                size="sm"
                                onClick={() => {
                                  void handleDeleteDocument(document.id);
                                }}
                                disabled={deletingDocumentId === document.id}
                              >
                                {deletingDocumentId === document.id ? (
                                  <Spinner animation="border" size="sm" role="status" />
                                ) : (
                                  'Eliminar'
                                )}
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </Accordion.Body>
                </Accordion.Item>
              </Accordion>
            </div>
          ) : null}
        </Modal.Body>
      </Modal>

      <Modal
        show={showReceiveWarning}
        onHide={() => setShowReceiveWarning(false)}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>Aviso</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          No puedes recibir un materia, sino lo has pedido antes, ¿Quieres hacer un pedido?
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setShowReceiveWarning(false)}>
            No
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setShowReceiveWarning(false);
              navigate('/materiales/materiales');
            }}
          >
            Sí
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}

export default MaterialsOrdersPage;
