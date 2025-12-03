import { useMemo } from 'react';
import { BudgetSectionLayout, type BudgetSectionLayoutProps } from './BudgetSectionLayout';
import { UnplannedSessionsTable } from '../../features/presupuestos/UnplannedSessionsTable';
import { OpenTrainingUnplannedTable } from '../../features/presupuestos/OpenTrainingUnplannedTable';

export type BudgetsPageProps = Omit<BudgetSectionLayoutProps, 'title' | 'subtitle'>;

export function BudgetsPage({ budgets, ...rest }: BudgetsPageProps) {
  const normalizeText = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();

  const openTrainingBudgets = useMemo(
    () => budgets.filter((budget) => normalizeText(budget.pipeline_label ?? '') === 'formacion abierta'),
    [budgets],
  );

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
        excludedPipelines={['Formacion Abierta']}
      />

      <OpenTrainingUnplannedTable budgets={openTrainingBudgets} />
    </BudgetSectionLayout>
  );
}
