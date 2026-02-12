import { BudgetSectionLayout, type BudgetSectionLayoutProps } from './BudgetSectionLayout';
import { OpenTrainingUnplannedTable } from '../../features/presupuestos/OpenTrainingUnplannedTable';
import { PendingTrainerSessionsTable } from '../../features/presupuestos/PendingTrainerSessionsTable';

export type BudgetsPageProps = Omit<BudgetSectionLayoutProps, 'title' | 'subtitle'>;

export function BudgetsPage({
  budgets,
  isLoading,
  isFetching,
  error,
  onRetry,
  onSelectSession,
  ...rest
}: BudgetsPageProps) {
  return (
    <BudgetSectionLayout
      {...rest}
      budgets={budgets}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
      title="Form. Empresa, Preventivos y PCI · Sin Formador"
      subtitle={undefined}
      canImport={false}
      tableContent={(filtersContainer) => (
        <PendingTrainerSessionsTable
          budgets={budgets}
          isLoading={isLoading}
          isFetching={isFetching}
          error={error}
          onRetry={onRetry}
          onSelectSession={onSelectSession}
          filtersContainer={filtersContainer}
        />
      )}
    >
      <OpenTrainingUnplannedTable budgets={budgets} />
    </BudgetSectionLayout>
  );
}
