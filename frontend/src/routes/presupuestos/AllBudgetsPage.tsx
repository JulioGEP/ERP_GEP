import { useMemo } from 'react';
import { BudgetSectionLayout, type BudgetSectionLayoutProps } from './BudgetSectionLayout';
import { isMaterialPipeline } from '../materiales/MaterialsBudgetsPage';

export type AllBudgetsPageProps = Omit<BudgetSectionLayoutProps, 'title' | 'subtitle' | 'enableFallback'>;

export function AllBudgetsPage({
  tableLabels,
  canImport: _unusedCanImport,
  budgets,
  serverQueryOptions,
  ...rest
}: AllBudgetsPageProps) {
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
    />
  );
}
