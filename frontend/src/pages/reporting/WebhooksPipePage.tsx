import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Card, Spinner, Table } from 'react-bootstrap';
import { isApiError } from '../../api/client';
import { fetchDealWebhookEvents, type DealWebhookEventReport } from '../../features/reporting/api';

function formatDate(value: string | null, formatter: Intl.DateTimeFormat): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return formatter.format(date);
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.trim().toLowerCase();
  let bg: string = 'secondary';
  if (normalized === 'imported') bg = 'success';
  else if (normalized === 'updated') bg = 'warning';
  else if (normalized === 'error') bg = 'danger';
  return (
    <Badge bg={bg} className="text-uppercase">
      {status}
    </Badge>
  );
}

function WarningsList({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return <span className="text-muted">—</span>;
  return (
    <ul className="mb-0 ps-3 small">
      {warnings.map((warning, index) => (
        <li key={`${warning}-${index}`}>{warning}</li>
      ))}
    </ul>
  );
}

function EventsTable({
  events,
  formatter,
}: {
  events: DealWebhookEventReport[];
  formatter: Intl.DateTimeFormat;
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
            <th>Warnings</th>
            <th>ID evento</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td className="text-nowrap">{formatDate(event.createdAt, formatter)}</td>
              <td>
                <div className="fw-semibold">{event.dealTitle || 'Sin título'}</div>
                <div className="text-muted small">ID: {event.dealId}</div>
              </td>
              <td className="text-nowrap">
                <StatusBadge status={event.status} />
              </td>
              <td>{event.message || <span className="text-muted">—</span>}</td>
              <td><WarningsList warnings={event.warnings} /></td>
              <td>
                <code className="small text-break">{event.id}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export default function WebhooksPipePage() {
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'short',
        timeStyle: 'medium',
      }),
    [],
  );

  const eventsQuery = useQuery({
    queryKey: ['reporting', 'webhooks_pipe'],
    queryFn: () => fetchDealWebhookEvents(),
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
      : 'No se pudo cargar el historial de webhooks.';
    content = <Alert variant="danger">{message}</Alert>;
  } else if (events.length === 0) {
    content = <Alert variant="info">Todavía no se han registrado eventos de webhooks.</Alert>;
  } else {
    content = <EventsTable events={events} formatter={formatter} />;
  }

  return (
    <section className="py-3">
      <Card className="shadow-sm">
        <Card.Header as="h1" className="h4 mb-0">
          Webhooks Pipedrive
        </Card.Header>
        <Card.Body>
          <p className="text-muted">
            Seguimiento de los eventos recibidos desde Pipedrive y su resultado en el ERP.
          </p>
          {content}
        </Card.Body>
      </Card>
    </section>
  );
}
