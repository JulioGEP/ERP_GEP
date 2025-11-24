import type { ComponentProps } from 'react';
import { MaterialsBudgetsPage as MaterialsBudgetsPageView } from '../../routes/materiales/MaterialsBudgetsPage';

export type MaterialsBudgetsPageProps = ComponentProps<typeof MaterialsBudgetsPageView>;

export default function MaterialsBudgetsPage(props: MaterialsBudgetsPageProps) {
  return <MaterialsBudgetsPageView {...props} />;
}
