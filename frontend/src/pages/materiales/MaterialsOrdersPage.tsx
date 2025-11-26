import type { ComponentProps } from 'react';
import { MaterialsOrdersPage as MaterialsOrdersPageView } from '../../routes/materiales/MaterialsOrdersPage';

export type MaterialsOrdersPageProps = ComponentProps<typeof MaterialsOrdersPageView>;

export default function MaterialsOrdersPage(props: MaterialsOrdersPageProps) {
  return <MaterialsOrdersPageView {...props} />;
}
