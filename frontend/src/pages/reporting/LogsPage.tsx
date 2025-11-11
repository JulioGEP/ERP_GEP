import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Spinner, Table } from 'react-bootstrap';
import { isApiError } from '../../api/client';
import { fetchAuditLogs, type AuditLogEntry } from '../../features/reporting/api';

function formatTimestamp(value: string | null, formatter: Intl.DateTimeFormat): string {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return formatter.format(date);
}

function UserInfo({ log }: { log: AuditLogEntry }) {
  const displayName = log.userName ?? null;
  const email = log.userEmail ?? null;
  const showName = Boolean(displayName);
  const showEmail = Boolean(email && email !== displayName);
  const showId = Boolean(log.userId);

  if (!showName && !showEmail && !showId) {
    return <span>—</span>;
  }

  return (
    <div>
      {showName ? <div className="fw-semibold">{displayName}</div> : null}
      {showEmail ? <div className="text-muted small">{email}</div> : null}
      {showId ? (
        <div className="text-muted small">
          ID: {log.userId}
        </div>
      ) : null}
    </div>
  );
}

type LogsTableProps = {
  logs: AuditLogEntry[];
  dateTimeFormatter: Intl.DateTimeFormat;
};

function LogsTable({ logs, dateTimeFormatter }: LogsTableProps) {
  return (
    <div className="table-responsive">
      <Table striped bordered hover size="sm">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Usuario</th>
            <th>Acción</th>
            <th>Entidad</th>
            <th>ID log</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td className="align-middle">{formatTimestamp(log.createdAt, dateTimeFormatter)}</td>
              <td className="align-middle">
                <UserInfo log={log} />
              </td>
              <td className="align-middle text-nowrap">{log.action || '—'}</td>
              <td className="align-middle">
                <div>{log.entityType || '—'}</div>
                <div className="text-muted small text-break">{log.entityId || '—'}</div>
              </td>
              <td className="align-middle">
                <code className="small text-break">{log.id}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export default function LogsPage() {
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'short',
        timeStyle: 'medium',
      }),
    [],
  );

  const logsQuery = useQuery({
    queryKey: ['reporting', 'logs'],
    queryFn: () => fetchAuditLogs(),
    staleTime: 5 * 60 * 1000,
  });

  const logs = logsQuery.data ?? [];

  let content: JSX.Element;

  if (logsQuery.isLoading) {
    content = (
      <div className="py-5 d-flex justify-content-center">
        <Spinner animation="border" role="status" />
      </div>
    );
  } else if (logsQuery.isError) {
    const error = logsQuery.error;
    const message = isApiError(error)
      ? error.message
      : 'No se pudo cargar la información de los logs de auditoría.';
    content = <Alert variant="danger">{message}</Alert>;
  } else if (logs.length === 0) {
    content = <Alert variant="info">No hay registros de auditoría disponibles.</Alert>;
  } else {
    content = <LogsTable logs={logs} dateTimeFormatter={dateTimeFormatter} />;
  }

  return (
    <section className="py-3">
      <Card className="shadow-sm">
        <Card.Header as="h1" className="h4 mb-0">
          Logs de auditoría
        </Card.Header>
        <Card.Body>
          <p className="text-muted">
            Revisión de las acciones realizadas en el sistema y su usuario asociado.
          </p>
          {content}
        </Card.Body>
      </Card>
    </section>
  );
}
