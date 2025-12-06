import type { ComponentProps } from 'react';
import { ProductsHoldedView } from '../../features/recursos/ProductsHoldedView';

type ProductsHoldedViewProps = ComponentProps<typeof ProductsHoldedView>;

export type ProductsHoldedPageProps = ProductsHoldedViewProps;

export default function ProductsHoldedPage(props: ProductsHoldedPageProps) {
  return <ProductsHoldedView {...props} />;
}
