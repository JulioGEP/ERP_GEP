import type { ComponentProps } from 'react';
import { StockProductsView } from '../../features/recursos/StockProductsView';

export type StockPageProps = ComponentProps<typeof StockProductsView>;

export default function StockPage(props: StockPageProps) {
  return <StockProductsView {...props} />;
}
