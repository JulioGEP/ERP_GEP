import type { ComponentProps } from 'react';
import { BudgetsPage as BudgetsPageView } from '../../routes/presupuestos/BudgetsPage';

export type BudgetsPageProps = ComponentProps<typeof BudgetsPageView>;

export default function BudgetsPage(props: BudgetsPageProps) {
  return <BudgetsPageView {...props} />;
}
