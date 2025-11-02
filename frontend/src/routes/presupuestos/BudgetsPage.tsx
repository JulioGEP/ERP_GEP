import { useMemo, useState, type ComponentType } from 'react';
import { Button, Spinner } from 'react-bootstrap';
import type { DealSummary } from '../../types/deal';
import { BudgetTable, type BudgetTableProps } from '../../features/presupuestos/BudgetTable';

type BudgetTableLabelsProp = BudgetTableProps['labels'];
type BudgetTableComponent = ComponentType<BudgetTableProps>;

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
  canImport: boolean;
  headerTitle?: string;
  headerSubtitle?: string | null;
  showImportButton?: boolean;
  tableLabels?: BudgetTableLabelsProp;
  TableComponent?: BudgetTableComponent;
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
  canImport,
  headerTitle,
  headerSubtitle,
  showImportButton = true,
  tableLabels,
  TableComponent = BudgetTable,
}: BudgetsPageProps) {
  const [filtersContainer, setFiltersContainer] = useState<HTMLDivElement | null>(null);
  const title = headerTitle ?? 'Presupuestos · Sin planificar';
  const subtitle = useMemo(() => {
    if (headerSubtitle === undefined) {
      return 'Sube tu presupuesto y planifica';
    }
    if (headerSubtitle === null) {
      return null;
    }
    const trimmed = headerSubtitle.trim();
    return trimmed.length ? trimmed : null;
  }, [headerSubtitle]);
  const showImportAction = showImportButton && canImport;

  return (
    <div className="d-grid gap-4">
      <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div className="d-flex flex-column gap-2">
          <div className="d-flex flex-wrap align-items-center gap-3">
            <h1 className="h3 fw-bold mb-0">{title}</h1>
            <div ref={setFiltersContainer} className="d-flex align-items-center gap-2 flex-wrap" />
          </div>
          {subtitle ? <p className="text-muted mb-0">{subtitle}</p> : null}
        </div>
        <div className="d-flex align-items-center gap-3">
          {(isImporting || isFetching) && <Spinner animation="border" role="status" size="sm" />}
          {showImportAction && (
            <Button size="lg" onClick={onOpenImportModal} disabled={isImporting}>
              Importar presupuesto
            </Button>
          )}
        </div>
      </section>

      <TableComponent
        budgets={budgets}
        isLoading={isLoading}
        isFetching={isFetching}
        error={error}
        onRetry={onRetry}
        onSelect={onSelect}
        onDelete={onDelete}
        filtersContainer={filtersContainer}
        labels={tableLabels}
      />
    </div>
  );
}
