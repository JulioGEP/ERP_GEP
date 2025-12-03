import { BudgetSectionLayout, type BudgetSectionLayoutProps } from './BudgetSectionLayout';
import { OpenTrainingUnplannedTable } from '../../features/presupuestos/OpenTrainingUnplannedTable';
import { PendingTrainerSessionsTable } from '../../features/presupuestos/PendingTrainerSessionsTable';

export type BudgetsPageProps = Omit<BudgetSectionLayoutProps, 'title' | 'subtitle'>;

export function BudgetsPage({ budgets, ...rest }: BudgetsPageProps) {
  return (
    <BudgetSectionLayout
      {...rest}
      budgets={budgets}
      title="Form. Empresa y GEP Services · Sin planificar"
      subtitle="Sube tu presupuesto y planifica"
      showFilters={false}
      tableComponent={
        <PendingTrainerSessionsTable
          budgets={budgets}
          isLoading={rest.isLoading}
          isFetching={rest.isFetching}
          error={rest.error}
          onRetry={rest.onRetry}
        />
      }
    >
      <OpenTrainingUnplannedTable budgets={budgets} />
    </BudgetSectionLayout>
  );
}
