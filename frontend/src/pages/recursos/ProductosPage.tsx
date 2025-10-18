import type { ComponentProps } from 'react';
import { ProductsView } from '../../features/recursos/ProductsView';

type ProductsViewProps = ComponentProps<typeof ProductsView>;

export type ProductosPageProps = ProductsViewProps;

export default function ProductosPage(props: ProductosPageProps) {
  return <ProductsView {...props} />;
}
