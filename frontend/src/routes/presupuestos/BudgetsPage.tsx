import { BudgetSectionLayout, type BudgetSectionLayoutProps } from './BudgetSectionLayout';
import { OpenTrainingUnplannedTable } from '../../features/presupuestos/OpenTrainingUnplannedTable';

export type BudgetsPageProps = Omit<BudgetSectionLayoutProps, 'title' | 'subtitle'>;

export function BudgetsPage({ budgets, ...rest }: BudgetsPageProps) {
  return (
    <BudgetSectionLayout
      {...rest}
      budgets={budgets}
      title="Presupuestos · Sin planificar"
      subtitle="Sube tu presupuesto y planifica"
    >
      <OpenTrainingUnplannedTable budgets={budgets} />
    </BudgetSectionLayout>
  );
}
