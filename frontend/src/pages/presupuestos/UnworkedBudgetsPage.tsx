import type { ComponentProps } from 'react';
import { BudgetsUnworkedPage as BudgetsUnworkedPageView } from '../../routes/presupuestos/UnworkedBudgetsPage';

export type BudgetsUnworkedPageProps = ComponentProps<typeof BudgetsUnworkedPageView>;

export default function BudgetsUnworkedPage(props: BudgetsUnworkedPageProps) {
  return <BudgetsUnworkedPageView {...props} />;
}
