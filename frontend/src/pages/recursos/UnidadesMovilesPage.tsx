import type { ComponentProps } from 'react';
import { MobileUnitsView } from '../../features/recursos/MobileUnitsView';

type MobileUnitsViewProps = ComponentProps<typeof MobileUnitsView>;

export type UnidadesMovilesPageProps = MobileUnitsViewProps;

export default function UnidadesMovilesPage(props: UnidadesMovilesPageProps) {
  return <MobileUnitsView {...props} />;
}
