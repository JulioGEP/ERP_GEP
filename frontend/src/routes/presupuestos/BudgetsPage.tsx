import { Badge, Button, Spinner } from 'react-bootstrap';
import type { DealSummary } from '../../types/deal';
import { BudgetTable } from '../../features/presupuestos/BudgetTable';
import { useCallback, useMemo, useState } from 'react';

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
  const [filtersControls, setFiltersControls] = useState<{ open: () => void; appliedCount: number } | null>(null);

  const handleOpenFilters = useCallback(() => {
    filtersControls?.open();
  }, [filtersControls]);

  const appliedFiltersCount = filtersControls?.appliedCount ?? 0;
  const filtersBadge = useMemo(() => {
    if (!appliedFiltersCount) return null;
    return (
      <Badge bg="primary" pill>
        {appliedFiltersCount}
      </Badge>
    );
  }, [appliedFiltersCount]);

  return (
    <div className="d-grid gap-4">
      <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div className="d-grid gap-2">
          <div className="d-flex align-items-center gap-3 flex-wrap">
            <h1 className="h3 fw-bold mb-0">Presupuestos · Sin planificar</h1>
            <Button
              variant="outline-primary"
              onClick={handleOpenFilters}
              disabled={!filtersControls}
              className="d-flex align-items-center gap-2"
            >
              <span>Filtros</span>
              {filtersBadge}
            </Button>
          </div>
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
        onFiltersReady={setFiltersControls}
      />
    </div>
  );
}
