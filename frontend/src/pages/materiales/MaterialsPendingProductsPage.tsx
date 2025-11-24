import type { ComponentProps } from 'react';
import { MaterialsPendingProductsPage as MaterialsPendingProductsPageView } from '../../routes/materiales/MaterialsPendingProductsPage';

export type MaterialsPendingProductsPageProps = ComponentProps<typeof MaterialsPendingProductsPageView>;

export default function MaterialsPendingProductsPage(props: MaterialsPendingProductsPageProps) {
  return <MaterialsPendingProductsPageView {...props} />;
}
