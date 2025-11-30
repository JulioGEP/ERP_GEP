import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Card, Spinner, Table } from 'react-bootstrap';
import { isApiError } from '../../api/client';
import { fetchPipedriveWebhookEvents, type PipedriveWebhookEvent } from '../../features/reporting/api';

function formatTimestamp(value: string | null, formatter: Intl.DateTimeFormat): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatter.format(date);
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.trim().toLowerCase();
  let variant: string = 'secondary';
  if (normalized === 'imported') variant = 'success';
  else if (normalized === 'updated') variant = 'warning';
  else if (normalized === 'error') variant = 'danger';

  return <Badge bg={variant}>{status}</Badge>;
}

function WebhookTable({
  events,
  dateTimeFormatter,
}: {
  events: PipedriveWebhookEvent[];
  dateTimeFormatter: Intl.DateTimeFormat;
}) {
  return (
    <div className="table-responsive">
      <Table striped bordered hover size="sm" className="align-middle">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Presupuesto</th>
            <th>Estado</th>
            <th>Mensaje</th>
            <th>Detalles</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td>{formatTimestamp(event.createdAt, dateTimeFormatter)}</td>
              <td>
                <div className="fw-semibold">{event.dealId}</div>
                <div className="text-muted small">ID evento: {event.id}</div>
              </td>
              <td>
                <StatusBadge status={event.status} />
              </td>
              <td>{event.message ?? '—'}</td>
              <td>
                {event.warnings ? (
                  <pre className="small mb-0 text-break bg-light p-2 rounded">
                    {JSON.stringify(event.warnings, null, 2)}
                  </pre>
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

export default function PipedriveWebhooksPage() {
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'short',
        timeStyle: 'medium',
      }),
    [],
  );

  const eventsQuery = useQuery({
    queryKey: ['reporting', 'webhooks_pipe'],
    queryFn: () => fetchPipedriveWebhookEvents(),
    staleTime: 5 * 60 * 1000,
  });

  const events = eventsQuery.data ?? [];

  let content: JSX.Element;
  if (eventsQuery.isLoading) {
    content = (
      <div className="py-5 d-flex justify-content-center">
        <Spinner animation="border" role="status" />
      </div>
    );
  } else if (eventsQuery.isError) {
    const error = eventsQuery.error;
    const message = isApiError(error)
      ? error.message
      : 'No se pudo cargar el historial de webhooks de Pipedrive.';
    content = <Alert variant="danger">{message}</Alert>;
  } else if (!events.length) {
    content = <Alert variant="info">No hay eventos registrados todavía.</Alert>;
  } else {
    content = <WebhookTable events={events} dateTimeFormatter={dateTimeFormatter} />;
  }

  return (
    <section className="py-3">
      <Card className="shadow-sm">
        <Card.Header as="h1" className="h4 mb-0">
          Webhooks de Pipedrive
        </Card.Header>
        <Card.Body>
          <p className="text-muted">
            Seguimiento de importaciones y actualizaciones recibidas desde Pipedrive.
          </p>
          {content}
        </Card.Body>
      </Card>
    </section>
  );
}
