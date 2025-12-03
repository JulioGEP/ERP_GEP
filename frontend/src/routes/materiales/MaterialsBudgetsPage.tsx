import { useMemo } from 'react';
import { BudgetSectionLayout, type BudgetSectionLayoutProps } from '../presupuestos/BudgetSectionLayout';
import { MATERIALS_BUDGET_FILTERS_CONFIG } from '../../features/presupuestos/BudgetTable';
import type { DealSummary } from '../../types/deal';

export type MaterialsBudgetsPageProps = Omit<BudgetSectionLayoutProps, 'title' | 'subtitle' | 'enableFallback'>;

function normalizePipelineKey(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export const MATERIAL_PIPELINE_KEYS = new Set(['materiales', 'material']);

export function isMaterialPipeline(budget: DealSummary): boolean {
  const labelKey = normalizePipelineKey(budget.pipeline_label);
  const idKey = normalizePipelineKey(budget.pipeline_id);
  return MATERIAL_PIPELINE_KEYS.has(labelKey) || MATERIAL_PIPELINE_KEYS.has(idKey);
}

function filterMaterialsBudgets(budgets: DealSummary[]): DealSummary[] {
  return budgets.filter((budget) => isMaterialPipeline(budget));
}

export function MaterialsBudgetsPage({ budgets, tableLabels, serverQueryOptions, ...rest }: MaterialsBudgetsPageProps) {
  const mergedLabels = useMemo(
    () => ({
      emptyTitle: 'No hay presupuestos del embudo Materiales.',
      emptyDescription: 'No se encontraron presupuestos que coincidan con los filtros aplicados.',
      ...(tableLabels ?? {}),
    }),
    [tableLabels],
  );

  const materialsBudgets = useMemo(() => filterMaterialsBudgets(budgets), [budgets]);

  const filteredServerQueryOptions = useMemo(() => {
    if (!serverQueryOptions?.fetcher) {
      return serverQueryOptions;
    }

    return {
      ...serverQueryOptions,
      fetcher: async (...args) => {
        const results = await serverQueryOptions.fetcher(...args);
        return filterMaterialsBudgets(results);
      },
    } satisfies typeof serverQueryOptions;
  }, [serverQueryOptions]);

  return (
    <BudgetSectionLayout
      {...rest}
      title="Materiales · Todos"
      subtitle="Presupuestos del embudo Materiales"
      enableFallback={false}
      budgets={materialsBudgets}
      tableLabels={mergedLabels}
      serverQueryOptions={filteredServerQueryOptions}
      filtersConfig={MATERIALS_BUDGET_FILTERS_CONFIG}
    />
  );
}

export default MaterialsBudgetsPage;
