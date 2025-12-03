import { BudgetSectionLayout, type BudgetSectionLayoutProps } from './BudgetSectionLayout';
import { UnplannedSessionsTable } from '../../features/presupuestos/UnplannedSessionsTable';

export type BudgetsPageProps = Omit<BudgetSectionLayoutProps, 'title' | 'subtitle'>;

export function BudgetsPage({ budgets, ...rest }: BudgetsPageProps) {
  return (
    <BudgetSectionLayout
      {...rest}
      budgets={budgets}
      title="Form. Empresa y GEP Services · Sin planificar"
      subtitle="Sube tu presupuesto y planifica"
      showFilters={false}
    >
      <UnplannedSessionsTable
        allowedPipelines={['GEP Services', 'Formación Empresa']}
        showFormationColumn={false}
      />
    </BudgetSectionLayout>
  );
}
