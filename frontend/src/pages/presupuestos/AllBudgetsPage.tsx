import type { ComponentProps } from 'react';
import { AllBudgetsPage as AllBudgetsPageView } from '../../routes/presupuestos/AllBudgetsPage';

export type AllBudgetsPageProps = ComponentProps<typeof AllBudgetsPageView>;

export default function AllBudgetsPage(props: AllBudgetsPageProps) {
  return <AllBudgetsPageView {...props} />;
}
