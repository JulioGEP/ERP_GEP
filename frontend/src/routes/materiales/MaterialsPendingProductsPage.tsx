import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Form, Modal, Spinner, Table } from 'react-bootstrap';
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
  quantityLabel: string;
  quantityValue: number | null;
  stockLabel: string;
  stockValue: number | null;
  supplier: string;
  estimatedDelivery: string;
  estimatedDeliveryValue: number | null;
};

type ProductHandling = 'stock' | 'supplier';

type SelectedProduct = {
  row: PendingProductRow;
  handling: ProductHandling;
  hasStock: boolean;
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

function getQuantityValue(quantity: number | string | null | undefined): number | null {
  if (quantity === null || quantity === undefined) return null;
  const numericQuantity = typeof quantity === 'string' ? Number(quantity) : quantity;
  return Number.isFinite(numericQuantity) ? numericQuantity : null;
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
      quantityLabel: formatQuantity(product?.quantity),
      quantityValue: getQuantityValue(product?.quantity),
      stockLabel: formatQuantity(product?.almacen_stock),
      stockValue: getQuantityValue(product?.almacen_stock),
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
  const [selectedProducts, setSelectedProducts] = useState<Record<string, SelectedProduct>>({});
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [nextOrderNumber, setNextOrderNumber] = useState(101);
  const [currentOrderNumber, setCurrentOrderNumber] = useState<number | null>(null);
  const [ccInput, setCcInput] = useState('');
  const [extraCc, setExtraCc] = useState<string[]>([]);
  const [mailSent, setMailSent] = useState(false);
  const hasError = !!error;
  const hasRows = pendingProducts.length > 0;

  const toggleProductSelection = (row: PendingProductRow) => {
    setSelectedProducts((current) => {
      const { key } = row;
      const hasStock =
        row.stockValue != null && row.quantityValue != null
          ? row.stockValue >= row.quantityValue
          : (row.stockValue ?? 0) > 0;

      if (current[key]) {
        const updated = { ...current };
        delete updated[key];
        return updated;
      }

      return {
        ...current,
        [key]: {
          row,
          handling: hasStock ? 'stock' : 'supplier',
          hasStock,
        },
      };
    });
  };

  const selectedList = useMemo(() => Object.values(selectedProducts), [selectedProducts]);

  const handleSelectAll = () => {
    const allSelected = pendingProducts.reduce<Record<string, SelectedProduct>>((acc, row) => {
      const hasStock = (row.quantityValue ?? 0) > 0;

      acc[row.key] = {
        row,
        handling: hasStock ? 'stock' : 'supplier',
        hasStock,
      };

      return acc;
    }, {});

    setSelectedProducts(allSelected);
  };

  const handleDeselectAll = () => {
    setSelectedProducts({});
  };

  const handleHandlingChange = (key: string, handling: ProductHandling) => {
    setSelectedProducts((current) => {
      const existing = current[key];
      if (!existing) return current;

      return {
        ...current,
        [key]: { ...existing, handling },
      };
    });
  };

  const openOrderModal = () => {
    if (!selectedList.length) return;
    setCurrentOrderNumber(nextOrderNumber);
    setShowOrderModal(true);
    setMailSent(false);
    setCcInput('');
    setExtraCc([]);
  };

  const closeOrderModal = () => {
    setShowOrderModal(false);
    setShowEmailModal(false);
  };

  const openEmailModal = () => {
    setShowEmailModal(true);
  };

  const closeEmailModal = () => {
    setShowEmailModal(false);
  };

  const handleSendEmail = () => {
    setMailSent(true);
    closeEmailModal();
    closeOrderModal();
    setNextOrderNumber((value) => value + 1);
    setSelectedProducts({});
  };

  const handleAddCc = () => {
    const trimmed = ccInput.trim();
    if (!trimmed) return;
    setExtraCc((current) => [...current, trimmed]);
    setCcInput('');
  };

  const defaultCommercialEmail = selectedList[0]?.row.budget.person?.email || 'comercial@gepgroup.es';

  const mailBody = selectedList
    .map(
      ({ row, handling }) =>
        `• ${row.productName} — Cantidad: ${row.quantityLabel} — Acción: ${
          handling === 'stock' ? 'Descontar de stock' : 'Pedido a proveedor'
        }`,
    )
    .join('\n');

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
          <Button
            size="lg"
            variant="primary"
            disabled={!selectedList.length}
            onClick={openOrderModal}
          >
            Crear pedido
          </Button>
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
                <th scope="col" className="align-middle">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <span>Seleccionar</span>
                    <Button
                      size="sm"
                      variant="outline-primary"
                      onClick={handleSelectAll}
                      disabled={!hasRows}
                    >
                      Seleccionar todo
                    </Button>
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      onClick={handleDeselectAll}
                      disabled={!selectedList.length}
                    >
                      Deseleccionar todo
                    </Button>
                  </div>
                </th>
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
                    <td onClick={(event) => event.stopPropagation()}>
                      <Form.Check
                        type="checkbox"
                        checked={Boolean(selectedProducts[row.key])}
                        onChange={() => toggleProductSelection(row)}
                        aria-label={`Seleccionar ${row.productName}`}
                      />
                    </td>
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

      <Modal show={showOrderModal} onHide={closeOrderModal} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>
            Pedido #{currentOrderNumber ?? nextOrderNumber}
            {mailSent ? <Badge bg="success" className="ms-2">Email enviado</Badge> : null}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-grid gap-3">
          <p className="mb-0 text-muted">Selecciona cómo gestionar cada producto.</p>

          <div className="table-responsive border rounded-3">
            <Table hover className="mb-0 align-middle">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Proveedor</th>
                  <th>Cantidad</th>
                  <th>Stock</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {selectedList.map(({ row, handling, hasStock }) => (
                  <tr key={row.key}>
                    <td>
                      <div className="fw-semibold">{row.productName}</div>
                      <div className="text-muted small">Presupuesto #{row.budgetId ?? '—'}</div>
                    </td>
                    <td>{row.supplier}</td>
                    <td>{row.quantityLabel}</td>
                    <td>{row.stockLabel}</td>
                    <td>
                      <div className="d-flex flex-column gap-2">
                        <Form.Check
                          type="radio"
                          id={`${row.key}-stock`}
                          name={`${row.key}-handling`}
                          label="Descontar de stock"
                          disabled={!hasStock}
                          checked={handling === 'stock' && hasStock}
                          onChange={() => handleHandlingChange(row.key, 'stock')}
                        />
                        <Form.Check
                          type="radio"
                          id={`${row.key}-supplier`}
                          name={`${row.key}-handling`}
                          label="Pedido a proveedor"
                          checked={handling === 'supplier'}
                          onChange={() => handleHandlingChange(row.key, 'supplier')}
                        />
                        {!hasStock && <div className="small text-muted">Sin stock disponible.</div>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          <div className="d-flex justify-content-between align-items-center">
            <div className="text-muted small">
              Número de pedido generado automáticamente a partir de 101.
            </div>
            <div className="d-flex gap-2">
              <Button variant="outline-secondary" onClick={closeOrderModal}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={openEmailModal}>
                Generar mail a proveedor
              </Button>
            </div>
          </div>
        </Modal.Body>
      </Modal>

      <Modal show={showEmailModal} onHide={closeEmailModal} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Simular envío de email</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-grid gap-3">
          <Form.Group>
            <Form.Label>Para</Form.Label>
            <Form.Control type="email" value="proveedores.mail_contacto" readOnly />
          </Form.Group>

          <Form.Group>
            <Form.Label>CC</Form.Label>
            <div className="d-flex flex-wrap gap-2 mb-2">
              <Badge bg="secondary">{defaultCommercialEmail}</Badge>
              {extraCc.map((cc) => (
                <Badge bg="info" key={cc}>
                  {cc}
                </Badge>
              ))}
            </div>
            <div className="d-flex gap-2">
              <Form.Control
                type="email"
                value={ccInput}
                placeholder="Añadir correo en copia"
                onChange={(event) => setCcInput(event.target.value)}
              />
              <Button variant="outline-primary" onClick={handleAddCc}>
                Añadir CC
              </Button>
            </div>
          </Form.Group>

          <Form.Group>
            <Form.Label>Asunto</Form.Label>
            <Form.Control
              type="text"
              readOnly
              value={`${currentOrderNumber ?? nextOrderNumber} Nuevo Pedido de GEP Group para ${
                selectedList[0]?.row.supplier || 'Proveedor'
              }`}
            />
          </Form.Group>

          <Form.Group>
            <Form.Label>Mensaje</Form.Label>
            <Form.Control
              as="textarea"
              rows={6}
              readOnly
              value={`Resumen de productos:\n${mailBody}\n\nPor favor, indícanos fechas estimadas de entrega.`}
            />
          </Form.Group>

          <div className="d-flex justify-content-end gap-2">
            <Button variant="outline-secondary" onClick={closeEmailModal}>
              Cancelar
            </Button>
            <Button variant="success" onClick={handleSendEmail}>
              Enviar desde erp@gepgroup.es
            </Button>
          </div>
        </Modal.Body>
      </Modal>
    </div>
  );
}

export default MaterialsPendingProductsPage;
