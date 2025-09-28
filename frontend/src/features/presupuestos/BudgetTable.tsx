import { Table } from 'react-bootstrap';
import type { DealSummary } from '../../types/deal';

interface BudgetTableProps {
  budgets: DealSummary[];
  onSelect: (budget: DealSummary) => void;
}

export function BudgetTable({ budgets, onSelect }: BudgetTableProps) {
  if (!budgets.length) {
    return (
      <div className="text-center py-5 text-muted bg-white rounded-4 shadow-sm">
        <p className="mb-1 fw-semibold">No hay presupuestos cargados todavía.</p>
        <p className="mb-0 small">Importa un presupuesto para comenzar a planificar la formación.</p>
      </div>
    );
  }

  return (
    <div className="table-responsive rounded-4 shadow-sm bg-white">
      <Table hover className="mb-0 align-middle">
        <thead>
          <tr>
            <th scope="col">Presupuesto</th>
            <th scope="col">Título</th>
            <th scope="col">Cliente</th>
            <th scope="col">Sede</th>
            <th scope="col">Formación</th>
          </tr>
        </thead>
        <tbody>
          {budgets.map((budget) => (
            <tr key={budget.dealId} role="button" onClick={() => onSelect(budget)}>
              <td className="fw-semibold">#{budget.dealId}</td>
              <td>{budget.title}</td>
              <td>{budget.clientName}</td>
              <td>{budget.sede}</td>
              <td>
                {budget.trainingNames.length ? (
                  <ul className="list-unstyled mb-0 small">
                    {budget.trainingNames.map((training) => (
                      <li key={training}>{training}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted">Sin productos formativos</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
