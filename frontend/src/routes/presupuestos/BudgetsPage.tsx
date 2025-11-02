import { BudgetSectionLayout, type BudgetSectionLayoutProps } from './BudgetSectionLayout';

export type BudgetsPageProps = Omit<BudgetSectionLayoutProps, 'title' | 'subtitle'>;

export function BudgetsPage(props: BudgetsPageProps) {
  return (
    <BudgetSectionLayout
      {...props}
      title="Presupuestos · Sin planificar"
      subtitle="Sube tu presupuesto y planifica"
    />
  );
}
