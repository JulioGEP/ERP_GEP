import { useCallback, useMemo, useState } from 'react';
import { Badge, Button, Spinner } from 'react-bootstrap';
import type { DealSummary } from '../../types/deal';
import { BudgetTable, createBudgetFilterDefinitions } from '../../features/presupuestos/BudgetTable';
import { FilterToolbar } from '../../components/table/FilterToolbar';
import { useTableFilterState } from '../../hooks/useTableFilterState';

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
  const {
    filters: activeFilters,
    searchValue,
    setSearchValue,
    setFilterValue,
    removeFilterValue,
    clearAllFilters,
  } = useTableFilterState({ tableKey: 'budgets-table' });

  const handleFilterChange = useCallback(
    (key: string, values: string[]) => {
      setFilterValue(key, values);
    },
    [setFilterValue],
  );

  const handleRemoveFilterValue = useCallback(
    (key: string, value: string) => {
      removeFilterValue(key, value);
    },
    [removeFilterValue],
  );

  const totalActiveFilters = useMemo(
    () => Object.values(activeFilters).reduce((sum, values) => sum + values.length, 0),
    [activeFilters],
  );

  const [resultCount, setResultCount] = useState(0);

  const filterDefinitions = useMemo(
    () => createBudgetFilterDefinitions(budgets),
    [budgets],
  );

  return (
    <div className="d-grid gap-4">
      <section className="d-grid gap-3">
        <div className="d-flex flex-column flex-xl-row align-items-xl-center justify-content-between gap-3">
          <div className="d-flex flex-column gap-2 flex-grow-1">
            <div className="d-flex flex-wrap align-items-center gap-3">
              <h1 className="h3 fw-bold mb-0">Presupuestos · Sin planificar</h1>
              <FilterToolbar
                filters={filterDefinitions}
                activeFilters={activeFilters}
                searchValue={searchValue}
                onSearchChange={setSearchValue}
                onFilterChange={handleFilterChange}
                onRemoveFilter={handleRemoveFilterValue}
                onClearAll={clearAllFilters}
                resultCount={resultCount}
                isServerBusy={isFetching}
                className="flex-grow-1 flex-lg-row align-items-lg-center gap-2"
                renderTrigger={({ open, hasActiveFilters }) => (
                  <Button
                    variant={hasActiveFilters ? 'primary' : 'outline-primary'}
                    className="fw-semibold d-flex align-items-center gap-2"
                    onClick={open}
                  >
                    Filtros
                    {totalActiveFilters > 0 ? (
                      <Badge bg="light" text="dark" className="rounded-pill px-2 py-1 small fw-semibold">
                        {totalActiveFilters}
                      </Badge>
                    ) : null}
                  </Button>
                )}
              />
            </div>
            <p className="text-muted mb-0">Sube tu presupuesto y planifica</p>
          </div>
          <div className="d-flex align-items-center gap-3">
            {(isImporting || isFetching) && <Spinner animation="border" role="status" size="sm" />}
            <Button size="lg" onClick={onOpenImportModal}>
              Importar presupuesto
            </Button>
          </div>
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
        showToolbar={false}
        onResultCountChange={setResultCount}
        filterDefinitions={filterDefinitions}
      />
    </div>
  );
}
