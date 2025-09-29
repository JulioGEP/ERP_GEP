import { Alert, Badge, Button, Spinner, Table } from 'react-bootstrap';
import type { DealSummary } from '../../types/deal';

interface BudgetTableProps {
  budgets: DealSummary[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  onSelect: (budget: DealSummary) => void;
}

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function formatList(values?: string[]): JSX.Element | string {
  if (!values?.length) {
    return <span className="text-muted">Sin datos</span>;
  }

  if (values.length === 1) {
    return values[0];
  }

  return (
    <ul className="list-unstyled mb-0 small">
      {values.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  );
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
            <th scope="col">Formación</th>
            <th scope="col">Horas</th>
            <th scope="col">Dirección</th>
            <th scope="col">CAES</th>
            <th scope="col">FUNDAE</th>
            <th scope="col">Hotel</th>
            <th scope="col">Docs</th>
            <th scope="col">Actualizado</th>
          </tr>
        </thead>
        <tbody>
          {budgets.map((budget) => {
            const trainingNames = Array.isArray(budget.trainingNames) ? budget.trainingNames : undefined;
            const prodExtraNames = Array.isArray(budget.prodExtraNames) ? budget.prodExtraNames : undefined;
            const documentsNum = budget.documentsNum ?? budget.documents?.length ?? 0;
            const notesCount = budget.notesCount ?? budget.notes?.length ?? 0;

            return (
              <tr key={budget.dealId} role="button" onClick={() => onSelect(budget)}>
                <td className="fw-semibold">#{budget.dealId}</td>
                <td>
                  <div className="fw-semibold">{budget.clientName}</div>
                  <div className="text-muted small">ID Org: {budget.dealOrgId}</div>
                </td>
                <td>{budget.sede}</td>
                <td className="small">
                  {formatList(trainingNames)}
                  {prodExtraNames && prodExtraNames.length ? (
                    <div className="mt-2 d-flex flex-wrap gap-1">
                      {prodExtraNames.map((extra) => (
                        <Badge bg="light" text="dark" key={extra} className="border">
                          Extra: {extra}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </td>
                <td>{budget.hours ?? '—'}</td>
                <td>{budget.dealDirection ?? '—'}</td>
                <td>{budget.caes ?? '—'}</td>
                <td>{budget.fundae ?? '—'}</td>
                <td>{budget.hotelNight ?? '—'}</td>
                <td>
                  <div>{documentsNum}</div>
                  <div className="text-muted small">Notas: {notesCount}</div>
                </td>
                <td>{formatDate(budget.updatedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
