import { useCallback, useState } from 'react';
import { Button, Spinner } from 'react-bootstrap';
import { UnplannedSessionsTable } from '../../features/presupuestos/UnplannedSessionsTable';
import type { UnplannedSessionSummary } from '../../features/presupuestos/api/sessions.api';

export interface UnplannedSessionsPageProps {
  onSelectSession?: (session: UnplannedSessionSummary) => void;
  canImport?: boolean;
  isImporting?: boolean;
  onOpenImportModal?: () => void;
}

export function UnplannedSessionsPage({
  onSelectSession,
  canImport = false,
  isImporting = false,
  onOpenImportModal,
}: UnplannedSessionsPageProps) {
  const [filtersContainer, setFiltersContainer] = useState<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [isFetching, setIsFetching] = useState(false);

  const handleStateChange = useCallback(
    ({ visible, total, fetching }: { visible: number; total: number; fetching: boolean }) => {
      setVisibleCount(visible);
      setTotalCount(total);
      setIsFetching(fetching);
    },
    [],
  );

  const counterLabel = totalCount === visibleCount ? `${totalCount}` : `${visibleCount}/${totalCount}`;

  return (
    <div className="d-grid gap-4">
      <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div className="d-flex flex-column gap-2">
          <div className="d-flex flex-wrap align-items-center gap-3">
            <h1 className="h3 fw-bold mb-0">Sesiones sin agendar</h1>
            <div ref={setFiltersContainer} className="d-flex align-items-center gap-2 flex-wrap" />
          </div>
          <p className="text-muted mb-0">Sesiones en la tabla: {counterLabel}</p>
        </div>
        <div className="d-flex align-items-center gap-3">
          {(isImporting || isFetching) && <Spinner animation="border" role="status" size="sm" />}
          {canImport && (
            <Button size="lg" onClick={onOpenImportModal} disabled={isImporting}>
              Importar presupuesto
            </Button>
          )}
        </div>
      </section>

      <UnplannedSessionsTable
        onSelectSession={onSelectSession}
        filtersContainer={filtersContainer}
        viewStorageKey="unplanned-sessions"
        onStateChange={handleStateChange}
      />
    </div>
  );
}

export default UnplannedSessionsPage;
