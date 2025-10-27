import { useState } from 'react';
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
  canImportBudget: boolean;
  title?: string;
  subtitle?: string;
  showFollowUpColumns?: boolean;
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
  canImportBudget,
  title,
  subtitle,
  showFollowUpColumns = false,
}: BudgetsPageProps) {
  const [filtersContainer, setFiltersContainer] = useState<HTMLDivElement | null>(null);

  const heading = title ?? 'Presupuestos · Sin planificar';
  const description = subtitle ?? 'Sube tu presupuesto y planifica';

  return (
    <div className="d-grid gap-4">
      <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div className="d-flex flex-column gap-2">
          <div className="d-flex flex-wrap align-items-center gap-3">
            <h1 className="h3 fw-bold mb-0">{heading}</h1>
            <div ref={setFiltersContainer} className="d-flex align-items-center gap-2 flex-wrap" />
          </div>
          <p className="text-muted mb-0">{description}</p>
        </div>
        <div className="d-flex align-items-center gap-3">
          {(isImporting || isFetching) && <Spinner animation="border" role="status" size="sm" />}
          {canImportBudget ? (
            <Button size="lg" onClick={onOpenImportModal}>
              Importar presupuesto
            </Button>
          ) : null}
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
        filtersContainer={filtersContainer}
        showFollowUpColumns={showFollowUpColumns}
      />
    </div>
  );
}
