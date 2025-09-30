import { Alert, Button, Spinner, Table } from 'react-bootstrap';
import type { DealSummary } from '../../types/deal';

interface BudgetTableProps {
  budgets: DealSummary[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  onSelect: (budget: DealSummary) => void;
}

function getProductNames(budget: DealSummary): string[] {
  if (Array.isArray(budget.trainingNames) && budget.trainingNames.length) {
    return budget.trainingNames;
  }

  if (Array.isArray(budget.training) && budget.training.length) {
    return budget.training
      .map((product) => (product.name ?? product.code ?? '')?.toString().trim())
      .filter((value): value is string => Boolean(value));
  }

  return [];
}

function getProductLabel(budget: DealSummary): { label: string; title?: string } {
  const names = getProductNames(budget);

  if (!names.length) {
    return { label: '—' };
  }

  if (names.length === 1) {
    return { label: names[0] };
  }

  return {
    label: `${names[0]} (+${names.length - 1})`,
    title: names.join(', ')
  };
}

export function BudgetTable({ budgets, isLoading, isFetching, error, onRetry, onSelect }: BudgetTableProps) {
  if (isLoading) {
    return (
      <div className="text-center py-5 text-muted bg-white rounded-4 shadow-sm">
        <Spinner animation="border" role="status" className="mb-3" />
        <p className="mb-0">Cargando presupuestos desde la base de datos…</p>
      </div>
    );
  }

  if (error) {
    const message = error instanceof Error ? error.message : 'No se pudo cargar el listado de presupuestos.';
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

  if (!budgets.length) {
    return (
      <div className="text-center py-5 text-muted bg-white rounded-4 shadow-sm">
        <p className="mb-1 fw-semibold">No hay presupuestos sin sesiones pendientes.</p>
        <p className="mb-0 small">Importa un presupuesto para comenzar a planificar la formación.</p>
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
            <th scope="col">Presupuesto</th>
            <th scope="col">Cliente</th>
            <th scope="col">Sede</th>
            <th scope="col">Producto</th>
          </tr>
        </thead>
        <tbody>
          {budgets.map((budget, index) => {
            const productInfo = getProductLabel(budget);
            const presupuestoLabel =
              budget.dealId ||
              (budget.dealNumericId != null ? String(budget.dealNumericId) : budget.title || '—');
            const presupuestoTitle = budget.title && budget.title !== presupuestoLabel ? budget.title : undefined;
            const sedeLabel = budget.sede && budget.sede.trim() ? budget.sede : '—';
            const clientLabel = budget.clientName || budget.organizationName;

            return (
              <tr
                key={budget.dealId || presupuestoLabel || presupuestoTitle || `${budget.organizationName}-${index}`}
                role="button"
                onClick={() => onSelect(budget)}
              >
                <td className="fw-semibold" title={presupuestoTitle}>
                  {presupuestoLabel}
                </td>
                <td>{clientLabel}</td>
                <td>{sedeLabel}</td>
                <td title={productInfo.title}>{productInfo.label}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
