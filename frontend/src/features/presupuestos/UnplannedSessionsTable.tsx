import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Spinner, Table } from 'react-bootstrap';
import { fetchUnplannedSessions, type UnplannedSessionSummary } from './api/sessions.api';

const queryConfig = {
  queryKey: ['sessions', 'unplanned'],
  queryFn: fetchUnplannedSessions,
  staleTime: 5 * 60 * 1000,
};

function ProductTags({ tags }: { tags: string[] }) {
  if (!tags.length) {
    return <span className="text-muted">—</span>;
  }

  return (
    <div className="d-flex flex-wrap gap-2">
      {tags.map((tag) => (
        <Badge key={tag} bg="secondary" className="text-bg-secondary bg-opacity-25 text-secondary-emphasis">
          {tag}
        </Badge>
      ))}
    </div>
  );
}

function renderRow(session: UnplannedSessionSummary) {
  const sessionLabel = session.sessionName?.trim() || 'Sesión sin nombre';
  const pipelineLabel = session.pipeline?.trim() || '—';
  const organizationLabel = session.organizationName?.trim() || '—';

  return (
    <tr key={session.id}>
      <td className="fw-semibold">{session.dealId}</td>
      <td>{organizationLabel}</td>
      <td>{sessionLabel}</td>
      <td>
        <ProductTags tags={session.productTags} />
      </td>
      <td>
        <Badge bg="info" className="text-bg-info bg-opacity-25 text-info-emphasis">
          {pipelineLabel}
        </Badge>
      </td>
    </tr>
  );
}

export function UnplannedSessionsTable() {
  const query = useQuery(queryConfig);

  if (query.isLoading) {
    return (
      <div className="text-center py-5 text-muted bg-white rounded-4 shadow-sm">
        <Spinner animation="border" role="status" className="mb-3" />
        <p className="mb-0">Cargando sesiones sin agendar…</p>
      </div>
    );
  }

  if (query.error) {
    const message = query.error instanceof Error ? query.error.message : 'No se pudieron cargar las sesiones sin agendar.';
    return (
      <Alert variant="danger" className="rounded-4 shadow-sm">
        <div className="d-flex justify-content-between align-items-start gap-3">
          <div>
            <h2 className="h6 mb-2">Error al cargar la tabla</h2>
            <p className="mb-0 text-muted">{message}</p>
          </div>
          <button type="button" className="btn btn-outline-danger" onClick={() => query.refetch()}>
            Reintentar
          </button>
        </div>
      </Alert>
    );
  }

  const sessions = query.data ?? [];

  if (!sessions.length) {
    return (
      <Alert variant="info" className="rounded-4 shadow-sm">
        <p className="mb-0">No hay sesiones pendientes de agendar en Formación Empresa o GEP Services.</p>
      </Alert>
    );
  }

  return (
    <div className="bg-white rounded-4 shadow-sm">
      <div className="d-flex justify-content-between align-items-center px-3 px-md-4 py-3 border-bottom">
        <div>
          <h2 className="h5 mb-1">Sesiones sin fecha planificada</h2>
          <p className="mb-0 text-muted">Listado de sesiones sin fecha de inicio y fin.</p>
        </div>
        {query.isFetching ? <Spinner animation="border" size="sm" role="status" /> : null}
      </div>

      <div className="table-responsive">
        <Table hover responsive className="mb-0 align-middle">
          <thead className="table-light">
            <tr>
              <th scope="col" style={{ minWidth: 120 }}>Presu</th>
              <th scope="col" style={{ minWidth: 180 }}>Empresa</th>
              <th scope="col" style={{ minWidth: 200 }}>Sesión</th>
              <th scope="col" style={{ minWidth: 240 }}>Formación</th>
              <th scope="col" style={{ minWidth: 170 }}>Negocio</th>
            </tr>
          </thead>
          <tbody>{sessions.map(renderRow)}</tbody>
        </Table>
      </div>
    </div>
  );
}
