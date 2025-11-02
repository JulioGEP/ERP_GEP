import { useMemo } from 'react';
import { BudgetSectionLayout, type BudgetSectionLayoutProps } from './BudgetSectionLayout';

export type UnworkedBudgetsPageProps = Omit<BudgetSectionLayoutProps, 'title' | 'subtitle' | 'enableFallback'>;

export function UnworkedBudgetsPage({ tableLabels, ...rest }: UnworkedBudgetsPageProps) {
  const mergedLabels = useMemo(
    () => ({
      emptyTitle: 'No hay presupuestos sin trabajar.',
      emptyDescription:
        'No encontramos presupuestos con gestiones pendientes en FUNDAE, CAES, Hotel, Transporte o PO.',
      ...(tableLabels ?? {}),
    }),
    [tableLabels],
  );

  return (
    <BudgetSectionLayout
      {...rest}
      title="Presupuestos · Sin trabajar"
      subtitle="Presupuestos con necesidades externas marcadas como “Sí” y pendientes de gestionar"
      enableFallback={false}
      tableLabels={mergedLabels}
    />
  );
}
