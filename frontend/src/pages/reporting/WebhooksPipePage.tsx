import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Card, Spinner, Table } from 'react-bootstrap';
import { isApiError } from '../../api/client';
import { fetchWebhookPipeLogs, type WebhookPipeLogEntry } from '../../features/reporting/api';

function formatDate(value: string | null, formatter: Intl.DateTimeFormat): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatter.format(date);
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return <Badge bg="secondary">Desconocido</Badge>;
  }
  const normalized = status.trim().toUpperCase();
  if (normalized === 'NEW') return <Badge bg="success">Nuevo</Badge>;
  if (normalized === 'UPDATED') return <Badge bg="warning" text="dark">Actualizado</Badge>;
  if (normalized === 'ERROR') return <Badge bg="danger">Error</Badge>;
  return <Badge bg="secondary">{status}</Badge>;
}

function LogsTable({ logs, dateTimeFormatter }: { logs: WebhookPipeLogEntry[]; dateTimeFormatter: Intl.DateTimeFormat }) {
  return (
    <div className="table-responsive">
      <Table striped bordered hover size="sm" className="align-middle">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Presupuesto</th>
            <th>Estado</th>
            <th>Mensaje</th>
            <th>Avisos</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td>{formatDate(log.createdAt, dateTimeFormatter)}</td>
              <td className="text-break">{log.dealId ?? '—'}</td>
              <td><StatusBadge status={log.status} /></td>
              <td className="text-break">{log.message ?? '—'}</td>
              <td>
                {log.warnings?.length ? (
                  <ul className="mb-0 small text-muted">
                    {log.warnings.map((warning, index) => (
                      <li key={`${log.id}-warning-${index}`}>{warning}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export default function WebhooksPipePage() {
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'short',
        timeStyle: 'medium',
      }),
    [],
  );

  const logsQuery = useQuery({
    queryKey: ['reporting', 'webhooks_pipe'],
    queryFn: () => fetchWebhookPipeLogs(),
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
      : 'No se pudo cargar el histórico de webhooks.';
    content = <Alert variant="danger">{message}</Alert>;
  } else if (!logs.length) {
    content = <Alert variant="info">No hay registros de webhooks disponibles.</Alert>;
  } else {
    content = <LogsTable logs={logs} dateTimeFormatter={dateTimeFormatter} />;
  }

  return (
    <section className="py-3">
      <Card className="shadow-sm">
        <Card.Header as="h1" className="h4 mb-0">
          Webhooks de Pipedrive
        </Card.Header>
        <Card.Body>
          <p className="text-muted">
            Seguimiento de importaciones automáticas de presupuestos desde Pipedrive y sus resultados.
          </p>
          {content}
        </Card.Body>
      </Card>
    </section>
  );
}
