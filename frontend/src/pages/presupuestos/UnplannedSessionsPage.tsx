import type { ComponentProps } from 'react';
import { UnplannedSessionsPage as UnplannedSessionsPageView } from '../../routes/presupuestos/UnplannedSessionsPage';

export type UnplannedSessionsPageProps = ComponentProps<typeof UnplannedSessionsPageView>;

export default function UnplannedSessionsPage(props: UnplannedSessionsPageProps) {
  return <UnplannedSessionsPageView {...props} />;
}
