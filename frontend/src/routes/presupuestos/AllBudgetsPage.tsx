import { useMemo } from 'react';
import { BudgetSectionLayout, type BudgetSectionLayoutProps } from './BudgetSectionLayout';

export type AllBudgetsPageProps = Omit<BudgetSectionLayoutProps, 'title' | 'subtitle' | 'enableFallback'>;

export function AllBudgetsPage({ tableLabels, canImport: _unusedCanImport, ...rest }: AllBudgetsPageProps) {
  const mergedLabels = useMemo(
    () => ({
      emptyTitle: 'No hay presupuestos disponibles.',
      emptyDescription: 'No se encontraron presupuestos que coincidan con los filtros aplicados.',
      ...(tableLabels ?? {}),
    }),
    [tableLabels],
  );

  return (
    <BudgetSectionLayout
      {...rest}
      title="Presupuestos · Todos"
      subtitle="Consulta todos los presupuestos de los diferentes embudos"
      enableFallback={false}
      tableLabels={mergedLabels}
      canImport={false}
    />
  );
}
