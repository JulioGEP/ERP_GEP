import { SessionBulkImportView } from '../../features/recursos/SessionBulkImportView';

export type SessionImportPageProps = Record<string, never>;

export function SessionImportPage(_props: SessionImportPageProps) {
  return <SessionBulkImportView />;
}

export default SessionImportPage;
