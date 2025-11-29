import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Button, Spinner } from 'react-bootstrap';
import type { DealSummary } from '../../types/deal';
import type { TableFiltersState } from '../../hooks/useTableFilterState';
import {
  BudgetTable,
  type BudgetServerQueryOptions,
  type BudgetTableLabels,
  type BudgetTableVariant,
} from '../../features/presupuestos/BudgetTable';

export type BudgetSectionLayoutProps = {
  title: string;
  subtitle?: string;
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
  tableLabels?: Partial<BudgetTableLabels>;
  enableFallback?: boolean;
  showFilters?: boolean;
  serverQueryOptions?: BudgetServerQueryOptions;
  tableVariant?: BudgetTableVariant;
  pageSize?: number;
  defaultFilters?: TableFiltersState;
  onRefreshAll?: (budgets: DealSummary[]) => void;
  onVisibleBudgetsChange?: (budgets: DealSummary[]) => void;
  children?: ReactNode;
};

export function BudgetSectionLayout({
  title,
  subtitle,
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
  tableLabels,
  enableFallback = true,
  showFilters = true,
  serverQueryOptions,
  tableVariant = 'default',
  pageSize,
  defaultFilters,
  onRefreshAll,
  onVisibleBudgetsChange,
  children,
}: BudgetSectionLayoutProps) {
  const [filtersContainer, setFiltersContainer] = useState<HTMLDivElement | null>(null);
  const [visibleBudgets, setVisibleBudgets] = useState<DealSummary[]>(budgets);

  useEffect(() => {
    setVisibleBudgets(budgets);
  }, [budgets]);

  const handleRefreshAll = useCallback(() => {
    if (onRefreshAll) {
      onRefreshAll(visibleBudgets);
      return;
    }
    onRetry();
  }, [onRefreshAll, onRetry, visibleBudgets]);

  const handleVisibleBudgetsChange = useCallback(
    (rows: DealSummary[]) => {
      setVisibleBudgets(rows);
      onVisibleBudgetsChange?.(rows);
    },
    [onVisibleBudgetsChange],
  );

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
          <Button size="lg" variant="outline-secondary" onClick={handleRefreshAll} disabled={isLoading || isFetching}>
            Actualizar todo
          </Button>
          {canImport && (
            <Button size="lg" onClick={onOpenImportModal} disabled={isImporting}>
              Importar presupuesto
            </Button>
          )}
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
        labels={tableLabels}
        enableFallback={enableFallback}
        filtersContainer={filtersContainer}
        showFilters={showFilters}
        serverQueryOptions={serverQueryOptions}
        variant={tableVariant}
        pageSize={pageSize}
        defaultFilters={defaultFilters}
        onVisibleBudgetsChange={handleVisibleBudgetsChange}
      />

      {children}
    </div>
  );
}
