import type { ComponentProps } from 'react';
import { MaterialsBoardPage as MaterialsBoardPageView } from '../../routes/materiales/MaterialsBoardPage';

export type MaterialsBoardPageProps = ComponentProps<typeof MaterialsBoardPageView>;

export default function MaterialsBoardPage(props: MaterialsBoardPageProps) {
  return <MaterialsBoardPageView {...props} />;
}
