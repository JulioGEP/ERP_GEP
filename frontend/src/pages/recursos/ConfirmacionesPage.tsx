import type { ComponentProps } from 'react';
import { ConfirmationsView } from '../../features/recursos/ConfirmationsView';

type ConfirmationsViewProps = ComponentProps<typeof ConfirmationsView>;

export type ConfirmacionesPageProps = ConfirmationsViewProps;

export default function ConfirmacionesPage(props: ConfirmacionesPageProps) {
  return <ConfirmationsView {...props} />;
}
