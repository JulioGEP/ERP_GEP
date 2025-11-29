import type { ComponentProps } from 'react';
import { SessionsPage as SessionsPageView } from '../../routes/presupuestos/SessionsPage';

export type SessionsPageProps = ComponentProps<typeof SessionsPageView>;

export default function SessionsPage(props: SessionsPageProps) {
  return <SessionsPageView {...props} />;
}
