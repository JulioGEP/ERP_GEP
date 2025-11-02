import type { ComponentProps } from 'react';
import { UnworkedBudgetsPage as UnworkedBudgetsPageView } from '../../routes/presupuestos/UnworkedBudgetsPage';

export type UnworkedBudgetsPageProps = ComponentProps<typeof UnworkedBudgetsPageView>;

export default function UnworkedBudgetsPage(props: UnworkedBudgetsPageProps) {
  return <UnworkedBudgetsPageView {...props} />;
}
