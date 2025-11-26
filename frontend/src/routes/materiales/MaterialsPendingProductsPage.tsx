import type { SVGProps } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Form, Modal, Spinner, Table } from 'react-bootstrap';
import { isApiError } from '../../api/client';
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
  idPipe: string | null;
  productName: string;
  quantityLabel: string;
  quantityValue: number | null;
  stockLabel: string;
  stockValue: number | null;
  missingProductStockField: boolean;
  supplier: string;
  estimatedDelivery: string;
  estimatedDeliveryValue: number | null;
};

type ProductHandling = 'stock' | 'supplier';

type SelectedProduct = {
  row: PendingProductRow;
  handling: ProductHandling;
  hasStock: boolean;
  stockUsage: number;
};

function getProductIdentifier(row: PendingProductRow): string {
  return row.idPipe ?? row.productName;
}

function getUsedStockForProduct(
  row: PendingProductRow,
  selection: Record<string, SelectedProduct>,
  excludeKey?: string,
): number {
  const productId = getProductIdentifier(row);

  return Object.values(selection).reduce((total, product) => {
    if (excludeKey && product.row.key === excludeKey) return total;
    if (product.handling !== 'stock') return total;
    if (getProductIdentifier(product.row) !== productId) return total;
    return total + (product.stockUsage ?? 0);
  }, 0);
}

function getRemainingStockForProduct(
  row: PendingProductRow,
  selection: Record<string, SelectedProduct>,
  excludeKey?: string,
): number {
  const usedStock = getUsedStockForProduct(row, selection, excludeKey);
  const baseStock = row.stockValue ?? 0;
  return Math.max(0, baseStock - usedStock);
}

type IconProps = SVGProps<SVGSVGElement>;

function CheckSquareIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M14 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z" />
      <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l1.094 1.093z" />
    </svg>
  );
}

function DashSquareIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M14 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z" />
      <path d="M5 8a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5A.5.5 0 0 1 5 8" />
    </svg>
  );
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

function getProductName(product: DealProduct | null | undefined): string {
  const name = product?.name?.trim();
  if (name) return name;
  const code = product?.code?.trim();
  if (code) return code;
  return '—';
}

function parseNumericValue(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const trimmed = value.trim();
  if (!trimmed.length) return null;

  const direct = Number(trimmed);
  if (Number.isFinite(direct)) return direct;

  const match = trimmed.match(/[-+]?\d+(?:[.,]\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0].replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatQuantity(quantity: number | string | null | undefined): string {
  const numericQuantity = parseNumericValue(quantity);
  if (numericQuantity === null) return '—';
  return new Intl.NumberFormat('es-ES').format(numericQuantity);
}

function getQuantityValue(quantity: number | string | null | undefined): number | null {
  return parseNumericValue(quantity);
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

function buildErrorDetails(error: unknown): string[] {
  if (!error) return [];

  if (isApiError(error)) {
    const details = [`${error.message} (código: ${error.code})`];

    if (error.status) {
      details.push(`Estado HTTP: ${error.status}`);
    }

    return details;
  }

  if (error instanceof Error) {
    return [error.message];
  }

  if (typeof error === 'string') {
    return [error];
  }

  try {
    return [`Error inesperado: ${JSON.stringify(error)}`];
  } catch {
    return ['Error inesperado: no se pudo serializar el detalle.'];
  }
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
      idPipe: product?.id_pipe ?? product?.code ?? null,
      productName: getProductName(product),
      quantityLabel: formatQuantity(product?.quantity),
      quantityValue: getQuantityValue(product?.quantity),
      stockLabel: formatQuantity(product?.product_stock ?? product?.almacen_stock),
      stockValue: getQuantityValue(product?.product_stock ?? product?.almacen_stock),
      missingProductStockField: !(product && Object.prototype.hasOwnProperty.call(product, 'product_stock')),
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
  const defaultCommercialEmail = 'sales@gepgroup.es';
  const [ccInput, setCcInput] = useState('');
  const [ccEmails, setCcEmails] = useState<string[]>([defaultCommercialEmail]);
  const [toEmail, setToEmail] = useState('');
  const [mailSent, setMailSent] = useState(false);
  const defaultLogisticsEmail = 'logistica@gepgroup.es';
  const [logisticsToInput, setLogisticsToInput] = useState('');
  const [logisticsToEmails, setLogisticsToEmails] = useState<string[]>([defaultLogisticsEmail]);
  const [logisticsCcInput, setLogisticsCcInput] = useState('');
  const [logisticsCcEmails, setLogisticsCcEmails] = useState<string[]>([defaultCommercialEmail]);
  const hasError = !!error;
  const hasRows = pendingProducts.length > 0;
  const errorDetails = useMemo(() => buildErrorDetails(error), [error]);

  const hasMissingProductStock = useMemo(
    () => pendingProducts.some((row) => row.missingProductStockField),
    [pendingProducts],
  );

  if (hasMissingProductStock) {
    throw new Error('El endpoint de materiales pendientes no devuelve product_stock.');
  }

  const hasSufficientStock = (row: PendingProductRow) => {
    if (row.quantityValue == null || row.stockValue == null) return false;
    return row.quantityValue <= row.stockValue;
  };

  const getDefaultStockUsage = (row: PendingProductRow) => {
    const stockValue = row.stockValue ?? 0;
    const quantityValue = row.quantityValue ?? 0;
    return Math.max(0, Math.min(stockValue, quantityValue));
  };

  const toggleProductSelection = (row: PendingProductRow) => {
    setSelectedProducts((current) => {
      const { key } = row;
      const hasStock = (row.stockValue ?? 0) > 0;
      const remainingStock = getRemainingStockForProduct(row, current);

      if (current[key]) {
        const updated = { ...current };
        delete updated[key];
        return updated;
      }

      const canUseStock = hasStock && remainingStock > 0;
      const defaultStockUsage = canUseStock
        ? Math.min(getDefaultStockUsage(row), remainingStock)
        : 0;

      return {
        ...current,
        [key]: {
          row,
          handling: canUseStock ? 'stock' : 'supplier',
          hasStock,
          stockUsage: defaultStockUsage,
        },
      };
    });
  };

  const selectedList = useMemo(() => Object.values(selectedProducts), [selectedProducts]);

  const primaryBudget = selectedList[0]?.row.budget;
  const supplierInfo =
    (primaryBudget as DealSummary & {
      proveedores?: { mail_contacto?: string | null; nombre_contacto?: string | null; contact_name?: string | null };
      mail_contacto?: string | null;
      proveedor_contacto?: string | null;
      contacto_proveedor?: string | null;
    })?.proveedores ?? null;

  const supplierContactEmail =
    supplierInfo?.mail_contacto ??
    (primaryBudget as { mail_contacto?: string | null } | undefined)?.mail_contacto ??
    '';

  const supplierContactName =
    supplierInfo?.nombre_contacto ??
    supplierInfo?.contact_name ??
    (primaryBudget as { proveedor_contacto?: string | null } | undefined)?.proveedor_contacto ??
    (primaryBudget as { contacto_proveedor?: string | null } | undefined)?.contacto_proveedor ??
    selectedList[0]?.row.supplier ??
    'proveedor';

  useEffect(() => {
    if (showEmailModal) {
      setToEmail(supplierContactEmail || '');
    }
  }, [showEmailModal, supplierContactEmail]);

  const handleSelectAll = () => {
    const stockAllocation: Record<string, number> = {};

    const allSelected = pendingProducts.reduce<Record<string, SelectedProduct>>((acc, row) => {
      const hasStock = (row.stockValue ?? 0) > 0;
      const productId = getProductIdentifier(row);
      const remainingStock = Math.max(0, (row.stockValue ?? 0) - (stockAllocation[productId] ?? 0));
      const defaultStockUsage = hasStock ? Math.min(getDefaultStockUsage(row), remainingStock) : 0;
      const willUseStock = hasStock && defaultStockUsage > 0;

      if (willUseStock) {
        stockAllocation[productId] = (stockAllocation[productId] ?? 0) + defaultStockUsage;
      }

      acc[row.key] = {
        row,
        handling: willUseStock ? 'stock' : 'supplier',
        hasStock,
        stockUsage: defaultStockUsage,
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

      const remainingStock = getRemainingStockForProduct(existing.row, current, key);

      const nextStockUsage =
        handling === 'stock'
          ? Math.min(existing.stockUsage || getDefaultStockUsage(existing.row), remainingStock)
          : 0;

      return {
        ...current,
        [key]: { ...existing, handling, stockUsage: nextStockUsage },
      };
    });
  };

  const handleStockUsageChange = (key: string, value: number) => {
    setSelectedProducts((current) => {
      const existing = current[key];
      if (!existing) return current;

      const remainingStock = getRemainingStockForProduct(existing.row, current, key);
      const sanitizedValue = Number.isFinite(value) ? Math.max(0, Math.min(remainingStock, value)) : 0;

      return {
        ...current,
        [key]: {
          ...existing,
          handling: 'stock',
          stockUsage: sanitizedValue,
        },
      };
    });
  };

  const openOrderModal = () => {
    if (!selectedList.length) return;
    setCurrentOrderNumber(nextOrderNumber);
    setShowOrderModal(true);
    setMailSent(false);
    setCcInput('');
    setCcEmails([defaultCommercialEmail]);
    setLogisticsToInput('');
    setLogisticsToEmails([defaultLogisticsEmail]);
    setLogisticsCcInput('');
    setLogisticsCcEmails([defaultCommercialEmail]);
  };

  const closeOrderModal = () => {
    setShowOrderModal(false);
    setShowEmailModal(false);
    setToEmail('');
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
    setCcEmails((current) => (current.includes(trimmed) ? current : [...current, trimmed]));
    setCcInput('');
  };

  const handleRemoveCc = (cc: string) => {
    setCcEmails((current) => current.filter((email) => email !== cc));
  };

  const handleAddLogisticsTo = () => {
    const trimmed = logisticsToInput.trim();
    if (!trimmed) return;
    setLogisticsToEmails((current) => (current.includes(trimmed) ? current : [...current, trimmed]));
    setLogisticsToInput('');
  };

  const handleRemoveLogisticsTo = (email: string) => {
    setLogisticsToEmails((current) => current.filter((item) => item !== email));
  };

  const handleAddLogisticsCc = () => {
    const trimmed = logisticsCcInput.trim();
    if (!trimmed) return;
    setLogisticsCcEmails((current) => (current.includes(trimmed) ? current : [...current, trimmed]));
    setLogisticsCcInput('');
  };

  const handleRemoveLogisticsCc = (email: string) => {
    setLogisticsCcEmails((current) => current.filter((item) => item !== email));
  };

  const supplierName = selectedList[0]?.row.supplier || 'irudek';

  const productRequests = selectedList.map(({ row, handling, stockUsage }) => {
    const totalQuantity = row.quantityValue ?? 0;
    const usedStock = handling === 'stock' ? stockUsage ?? 0 : 0;
    const supplierQuantity = Math.max(totalQuantity - usedStock, 0);

    return {
      productName: row.productName,
      supplierQuantity,
      stockQuantity: usedStock,
      totalLabel: row.quantityLabel,
    };
  });

  const supplierProductLines = productRequests
    .filter((product) => product.supplierQuantity > 0)
    .map((product) => `- ${product.productName} ${formatQuantity(product.supplierQuantity)}`)
    .join('\n');

  const emailBody = `Hola ${supplierContactName}\n\nDesde el equipo de GEP Group necesitamos un nuevo pedido\n${
    supplierProductLines || '- Sin productos para pedir (se cubrirá con stock disponible).'
  }\n\nDime si tienes disponibilidad y por favor, indícanos fechas estimadas de entrega.\n\nMuchas gracias de antemano.\n\nEquipo de GEP Group.`;

  const hasStockUsage = productRequests.some((product) => product.stockQuantity > 0);

  const logisticsProductLines = productRequests
    .filter((product) => product.stockQuantity > 0)
    .map((product) => `- ${product.productName} ${formatQuantity(product.stockQuantity)}`)
    .join('\n');

  const contactFullName = [primaryBudget?.person?.first_name, primaryBudget?.person?.last_name]
    .filter(Boolean)
    .join(' ');

  const budgetIdForSubject = primaryBudget?.deal_id ?? primaryBudget?.dealId ?? selectedList[0]?.row.budgetId ?? '—';
  const logisticsSubject = `Uso de stock para prespuesto ${budgetIdForSubject}`;

  const logisticsEmailBody = `Hola Logistica\n\nEl comercial asignado de este presupuesto es "${
    primaryBudget?.comercial ?? '—'
  }"\nNecesito utilizar inventario para enviar a cliente. \n${
    logisticsProductLines || '- Sin productos para descontar de stock.'
  }\n\nTenemos que enviarlos a la dirección ${
    primaryBudget?.direccion_envio ?? '—'
  } a nombre de "${contactFullName || '—'}" de la empresa "${
    primaryBudget?.organization?.name ?? '—'
  }"\n\nEl telefono de contacto es "${primaryBudget?.person?.phone ?? '—'}"\n\n¡Gracias!`;

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
              <p className="mb-2">No se pudieron obtener los productos. Inténtalo de nuevo.</p>
              {errorDetails.length ? (
                <div className="bg-light border rounded-3 p-2">
                  <p className="fw-semibold small text-danger mb-1">Detalle técnico:</p>
                  <ul className="mb-0 small">
                    {errorDetails.map((detail, index) => (
                      <li key={index}>
                        <code>{detail}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
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
                <th scope="col" className="align-middle text-nowrap" style={{ width: '1%' }}>
                  <div className="d-flex align-items-center gap-1 flex-wrap justify-content-center">
                    <span className="visually-hidden">Seleccionar</span>
                    <div className="btn-group" role="group" aria-label="Acciones de selección">
                      <Button
                        size="sm"
                        variant="outline-primary"
                        onClick={handleSelectAll}
                        disabled={!hasRows}
                        className="p-1 d-inline-flex align-items-center justify-content-center"
                        title="Seleccionar todo"
                        aria-label="Seleccionar todo"
                      >
                        <CheckSquareIcon width={18} height={18} />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        onClick={handleDeselectAll}
                        disabled={!selectedList.length}
                        className="p-1 d-inline-flex align-items-center justify-content-center"
                        title="Deseleccionar todo"
                        aria-label="Deseleccionar todo"
                      >
                        <DashSquareIcon width={18} height={18} />
                      </Button>
                    </div>
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
                <th scope="col">Stock</th>
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
                  <td colSpan={8} className="text-center py-4">
                    <Spinner animation="border" role="status" />
                  </td>
                </tr>
              ) : !hasRows ? (
                <tr>
                  <td colSpan={8} className="text-center py-4 text-muted">
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
                    <td
                      onClick={(event) => event.stopPropagation()}
                      className="text-center"
                      style={{ width: '1%' }}
                    >
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
                    <td className={hasSufficientStock(row) ? 'text-success fw-semibold' : 'text-danger fw-semibold'}>
                      {row.quantityLabel}
                    </td>
                    <td>{row.stockLabel}</td>
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
                {selectedList.map(({ row, handling, hasStock, stockUsage }) => {
                  const usedStock = getUsedStockForProduct(row, selectedProducts);
                  const remainingStock = getRemainingStockForProduct(row, selectedProducts, row.key);
                  const remainingForSupplier = Math.max(
                    (row.quantityValue ?? 0) - (handling === 'stock' ? stockUsage : 0),
                    0,
                  );

                  return (
                    <tr key={row.key}>
                    <td>
                      <div className="fw-semibold">{row.productName}</div>
                      <div className="text-muted small">Presupuesto #{row.budgetId ?? '—'}</div>
                    </td>
                  <td>{row.supplier}</td>
                    <td className={hasSufficientStock(row) ? 'text-success fw-semibold' : 'text-danger fw-semibold'}>
                      {row.quantityLabel}
                    </td>
                    <td>
                      <div className="fw-semibold">{formatQuantity(row.stockValue)}</div>
                      <div className="small text-muted">En uso: {formatQuantity(usedStock)}</div>
                      <div className="small text-muted">
                        Disponible: {formatQuantity(Math.max(0, (row.stockValue ?? 0) - usedStock))}
                      </div>
                    </td>
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
                        {hasStock ? (
                          <div className="d-flex flex-column gap-1 ps-3">
                            <div className="d-flex align-items-center gap-2 flex-wrap">
                              <Form.Label className="mb-0">Unidades de stock a usar</Form.Label>
                              <Form.Control
                                type="number"
                                min={0}
                                max={remainingStock}
                                value={handling === 'stock' ? stockUsage : 0}
                                disabled={handling !== 'stock'}
                                onChange={(event) =>
                                  handleStockUsageChange(row.key, Number(event.target.value))
                                }
                                style={{ maxWidth: 160 }}
                              />
                              <span className="small text-muted">
                                Máx: {formatQuantity(remainingStock)}
                              </span>
                            </div>
                            <div className="small text-muted">
                              Se pedirán {formatQuantity(remainingForSupplier)} unidades al proveedor.
                            </div>
                          </div>
                        ) : null}
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
                  );
                })}
              </tbody>
            </Table>
          </div>

          <div className="d-flex justify-content-end align-items-center">
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
          <Modal.Title>Envío de emails</Modal.Title>
        </Modal.Header>
        <Modal.Body className="d-grid gap-4">
          <div className="d-grid gap-3">
            <h5 className="mb-0">Email a proveedor</h5>
            <Form.Group>
              <Form.Label>Para</Form.Label>
              <Form.Control
                type="email"
                value={toEmail}
                placeholder="Correo de contacto del proveedor"
                onChange={(event) => setToEmail(event.target.value)}
              />
            </Form.Group>

            <Form.Group>
              <Form.Label>CC</Form.Label>
              <div className="d-flex flex-wrap gap-2 mb-2">
                {ccEmails.map((cc) => (
                  <Badge bg="secondary" key={cc} className="d-inline-flex align-items-center gap-2">
                    <span>{cc}</span>
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0 text-white"
                      onClick={() => handleRemoveCc(cc)}
                      aria-label={`Eliminar ${cc} de CC`}
                    >
                      ×
                    </Button>
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
                value={`Nuevo Pedido de GEP Group con Nº ${currentOrderNumber ?? nextOrderNumber} para ${supplierName}`}
              />
            </Form.Group>

            <Form.Group>
              <Form.Label>Mensaje</Form.Label>
              <Form.Control as="textarea" rows={6} readOnly value={emailBody} />
            </Form.Group>
          </div>

          {hasStockUsage ? (
            <div className="d-grid gap-3 border-top pt-3">
              <h5 className="mb-0">Email a Logística</h5>

              <Form.Group>
                <Form.Label>Para</Form.Label>
                <div className="d-flex flex-wrap gap-2 mb-2">
                  {logisticsToEmails.map((email) => (
                    <Badge bg="secondary" key={email} className="d-inline-flex align-items-center gap-2">
                      <span>{email}</span>
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0 text-white"
                        onClick={() => handleRemoveLogisticsTo(email)}
                        aria-label={`Eliminar ${email} de Para`}
                      >
                        ×
                      </Button>
                    </Badge>
                  ))}
                </div>
                <div className="d-flex gap-2">
                  <Form.Control
                    type="email"
                    value={logisticsToInput}
                    placeholder="Añadir correo de logística"
                    onChange={(event) => setLogisticsToInput(event.target.value)}
                  />
                  <Button variant="outline-primary" onClick={handleAddLogisticsTo}>
                    Añadir correo
                  </Button>
                </div>
              </Form.Group>

              <Form.Group>
                <Form.Label>CC</Form.Label>
                <div className="d-flex flex-wrap gap-2 mb-2">
                  {logisticsCcEmails.map((email) => (
                    <Badge bg="secondary" key={email} className="d-inline-flex align-items-center gap-2">
                      <span>{email}</span>
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0 text-white"
                        onClick={() => handleRemoveLogisticsCc(email)}
                        aria-label={`Eliminar ${email} de CC`}
                      >
                        ×
                      </Button>
                    </Badge>
                  ))}
                </div>
                <div className="d-flex gap-2">
                  <Form.Control
                    type="email"
                    value={logisticsCcInput}
                    placeholder="Añadir correo en copia"
                    onChange={(event) => setLogisticsCcInput(event.target.value)}
                  />
                  <Button variant="outline-primary" onClick={handleAddLogisticsCc}>
                    Añadir CC
                  </Button>
                </div>
              </Form.Group>

              <Form.Group>
                <Form.Label>Asunto</Form.Label>
                <Form.Control type="text" readOnly value={logisticsSubject} />
              </Form.Group>

              <Form.Group>
                <Form.Label>Mensaje</Form.Label>
                <Form.Control as="textarea" rows={6} readOnly value={logisticsEmailBody} />
              </Form.Group>
            </div>
          ) : null}

          <div className="d-flex justify-content-end gap-2">
            <Button variant="outline-secondary" onClick={closeEmailModal}>
              Cancelar
            </Button>
            <Button variant="success" onClick={handleSendEmail}>
              Enviar correos desde erp@gepgroup.es
            </Button>
          </div>
        </Modal.Body>
      </Modal>
    </div>
  );
}

export default MaterialsPendingProductsPage;
