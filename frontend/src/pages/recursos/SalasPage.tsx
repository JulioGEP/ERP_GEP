import type { ComponentProps } from 'react';
import { RoomsView } from '../../features/recursos/RoomsView';

type RoomsViewProps = ComponentProps<typeof RoomsView>;

export type SalasPageProps = RoomsViewProps;

export default function SalasPage(props: SalasPageProps) {
  return <RoomsView {...props} />;
}
