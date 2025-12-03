import { useMemo } from 'react';
import { BudgetSectionLayout, type BudgetSectionLayoutProps } from './BudgetSectionLayout';
import { OpenTrainingUnplannedTable } from '../../features/presupuestos/OpenTrainingUnplannedTable';
import { joinFilterValues } from '../../components/table/filterUtils';

export type BudgetsPageProps = Omit<BudgetSectionLayoutProps, 'title' | 'subtitle'>;

export function BudgetsPage({ budgets, ...rest }: BudgetsPageProps) {
  const defaultFilters = useMemo(
    () => ({
      negocio: joinFilterValues(['Formación Empresas', 'GEP Services']),
    }),
    [],
  );

  return (
    <BudgetSectionLayout
      {...rest}
      budgets={budgets}
      title="Form. Empresa y GEP Services · Sin planificar"
      subtitle="Sube tu presupuesto y planifica"
      showFilters={false}
      defaultFilters={defaultFilters}
    >
      <OpenTrainingUnplannedTable budgets={budgets} />
    </BudgetSectionLayout>
  );
}
