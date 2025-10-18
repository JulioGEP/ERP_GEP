import { Button, Spinner } from 'react-bootstrap';
import type { DealSummary } from '../../types/deal';
import { BudgetTable } from '../../features/presupuestos/BudgetTable';

type BudgetsPageProps = {
  budgets: DealSummary[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  onSelect: (budget: DealSummary) => void;
  onDelete?: (budget: DealSummary) => Promise<void>;
  onOpenImportModal: () => void;
  isImporting: boolean;
};

export function BudgetsPage({
  budgets,
  isLoading,
  isFetching,
  error,
  onRetry,
  onSelect,
  onDelete,
  onOpenImportModal,
  isImporting,
}: BudgetsPageProps) {
  return (
    <div className="d-grid gap-4">
      <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div>
          <h1 className="h3 fw-bold mb-1">Presupuestos</h1>
          <p className="text-muted mb-0">Sube tu presupuesto y planifica</p>
        </div>
        <div className="d-flex align-items-center gap-3">
          {(isImporting || isFetching) && <Spinner animation="border" role="status" size="sm" />}
          <Button size="lg" onClick={onOpenImportModal}>
            Importar presupuesto
          </Button>
        </div>
      </section>

      <BudgetTable
        budgets={budgets}
        isLoading={isLoading}
        isFetching={isFetching}
        error={error}
        onRetry={onRetry}
        onSelect={onSelect}
        onDelete={onDelete}
      />
    </div>
  );
}
