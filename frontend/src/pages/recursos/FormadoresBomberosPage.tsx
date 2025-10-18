import type { ComponentProps } from 'react';
import { TrainersView } from '../../features/recursos/TrainersView';

type TrainersViewProps = ComponentProps<typeof TrainersView>;

export type FormadoresBomberosPageProps = TrainersViewProps;

export default function FormadoresBomberosPage(props: FormadoresBomberosPageProps) {
  return <TrainersView {...props} />;
}
