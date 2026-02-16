import { useMemo, useState } from 'react';
import { Nav } from 'react-bootstrap';
import { BudgetSectionLayout, type BudgetSectionLayoutProps } from './BudgetSectionLayout';
import { BudgetTable } from '../../features/presupuestos/BudgetTable';
import { isMaterialPipeline } from '../materiales/MaterialsBudgetsPage';
import { PoDocumentsTable } from '../../features/presupuestos/PoDocumentsTable';

export type AllBudgetsPageProps = Omit<BudgetSectionLayoutProps, 'title' | 'subtitle' | 'enableFallback'>;

export function AllBudgetsPage({
  tableLabels,
  canImport: _unusedCanImport,
  budgets,
  serverQueryOptions,
  ...rest
}: AllBudgetsPageProps) {
  const [activeSubsection, setActiveSubsection] = useState<'presupuestos' | 'po-documents'>('presupuestos');

  const mergedLabels = useMemo(
    () => ({
      emptyTitle: 'No hay presupuestos disponibles.',
      emptyDescription: 'No se encontraron presupuestos que coincidan con los filtros aplicados.',
      ...(tableLabels ?? {}),
    }),
    [tableLabels],
  );

  const filteredBudgets = useMemo(
    () => budgets.filter((budget) => !isMaterialPipeline(budget)),
    [budgets],
  );

  const filteredServerQueryOptions = useMemo(() => {
    if (!serverQueryOptions?.fetcher) {
      return serverQueryOptions;
    }

    return {
      ...serverQueryOptions,
      fetcher: async (...args) => {
        const results = await serverQueryOptions.fetcher(...args);
        return results.filter((budget) => !isMaterialPipeline(budget));
      },
    } satisfies typeof serverQueryOptions;
  }, [serverQueryOptions]);

  return (
    <BudgetSectionLayout
      {...rest}
      title="Presupuestos · Todos"
      subtitle="Consulta todos los presupuestos de los diferentes embudos"
      enableFallback={false}
      budgets={filteredBudgets}
      tableLabels={mergedLabels}
      serverQueryOptions={filteredServerQueryOptions}
      canImport={false}
      tableContent={(filtersContainer) => (
        <div className="d-grid gap-3">
          <Nav variant="tabs" activeKey={activeSubsection}>
            <Nav.Item>
              <Nav.Link
                eventKey="presupuestos"
                onClick={() => setActiveSubsection('presupuestos')}
              >
                Presupuestos
              </Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link
                eventKey="po-documents"
                onClick={() => setActiveSubsection('po-documents')}
              >
                PO&apos;s
              </Nav.Link>
            </Nav.Item>
          </Nav>

          {activeSubsection === 'po-documents' ? (
            <PoDocumentsTable />
          ) : (
            <BudgetTable
              budgets={filteredBudgets}
              isLoading={rest.isLoading}
              isFetching={rest.isFetching}
              error={rest.error}
              onRetry={rest.onRetry}
              onSelect={rest.onSelect}
              onDelete={rest.onDelete}
              labels={mergedLabels}
              enableFallback={false}
              filtersContainer={filtersContainer}
              showFilters
              serverQueryOptions={filteredServerQueryOptions}
              variant={rest.tableVariant}
              pageSize={rest.pageSize}
              defaultFilters={rest.defaultFilters}
              filtersConfig={rest.filtersConfig}
            />
          )}
        </div>
      )}
    />
  );
}
