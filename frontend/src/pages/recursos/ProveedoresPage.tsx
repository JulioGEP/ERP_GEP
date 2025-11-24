import type { ComponentProps } from 'react';
import { ProvidersView } from '../../features/recursos/ProvidersView';

type ProvidersViewProps = ComponentProps<typeof ProvidersView>;

export type ProveedoresPageProps = ProvidersViewProps;

export default function ProveedoresPage(props: ProveedoresPageProps) {
  return <ProvidersView {...props} />;
}
