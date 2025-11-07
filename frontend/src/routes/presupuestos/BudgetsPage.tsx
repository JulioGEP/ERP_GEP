import { useMemo } from 'react';

import { BudgetSectionLayout, type BudgetSectionLayoutProps } from './BudgetSectionLayout';
import { OpenTrainingUnplannedTable } from '../../features/presupuestos/OpenTrainingUnplannedTable';

const TARGET_PIPELINE_KEYS = new Set<string>([
  normalizePipelineKey('Formación Empresa'),
  normalizePipelineKey('Formación Empresas'),
  normalizePipelineKey('GEP Services'),
]);

function normalizePipelineKey(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export type BudgetsPageProps = Omit<BudgetSectionLayoutProps, 'title' | 'subtitle'>;

export function BudgetsPage({ budgets, ...rest }: BudgetsPageProps) {
  const filteredBudgets = useMemo(
    () =>
      budgets.filter((budget) => {
        const pipelineKey = [budget.pipeline_label, budget.pipeline_id]
          .map((value) => normalizePipelineKey(value))
          .find((key) => key.length > 0);

        if (!pipelineKey) {
          return false;
        }

        return TARGET_PIPELINE_KEYS.has(pipelineKey);
      }),
    [budgets],
  );

  return (
    <BudgetSectionLayout
      {...rest}
      budgets={filteredBudgets}
      title="Formación Empresa y GEP Services · Sin planificar"
      subtitle="Sube tu presupuesto y planifica"
    >
      <OpenTrainingUnplannedTable budgets={filteredBudgets} />
    </BudgetSectionLayout>
  );
}
