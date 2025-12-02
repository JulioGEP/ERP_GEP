import { Fragment, useMemo, useState } from 'react';
import { Alert, Badge, Card, Spinner, Table } from 'react-bootstrap';
import { useQuery } from '@tanstack/react-query';
import { fetchPipedriveWebhookEvents, type PipedriveWebhookEvent } from '../../features/reporting/api';
import { isApiError } from '../../api/client';

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

function JsonCell({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted">—</span>;
  }

  return (
    <pre className="small mb-0 text-break bg-light p-2 rounded" style={{ whiteSpace: 'pre-wrap' }}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function EventTable({ events, formatter }: { events: PipedriveWebhookEvent[]; formatter: Intl.DateTimeFormat }) {
  const [expandedEventId, setExpandedEventId] = useState<number | null>(null);

  const handleRowClick = (eventId: number) => {
    setExpandedEventId((currentId) => (currentId === eventId ? null : eventId));
  };

  const columnCount = 9;

  return (
    <div className="table-responsive">
      <Table striped bordered hover size="sm" className="align-middle">
        <thead>
          <tr>
            <th style={{ minWidth: 170 }}>Fecha</th>
            <th>Evento</th>
            <th>Acción</th>
            <th>Objeto</th>
            <th>Empresa ID</th>
            <th>Objeto ID</th>
            <th>Reintento</th>
            <th>Token</th>
            <th>Cabeceras</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <Fragment key={event.id}>
              <tr
                role="button"
                className="table-row-button"
                onClick={() => handleRowClick(event.id)}
              >
                <td className="text-nowrap">{formatTimestamp(event.createdAt, formatter)}</td>
                <td>{event.event ?? '—'}</td>
                <td>{event.eventAction ?? '—'}</td>
                <td>{event.eventObject ?? '—'}</td>
                <td>{event.companyId ?? '—'}</td>
                <td>{event.objectId ?? '—'}</td>
                <td>
                  {typeof event.retry === 'number' ? (
                    <Badge bg={event.retry > 0 ? 'warning' : 'secondary'}>{event.retry}</Badge>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  {event.webhookToken ? (
                    <code className="text-break" style={{ wordBreak: 'break-all' }}>
                      {event.webhookToken}
                    </code>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  <JsonCell value={event.headers} />
                </td>
              </tr>
              {expandedEventId === event.id && (
                <tr>
                  <td colSpan={columnCount}>
                    <div className="fw-semibold mb-1">Payload</div>
                    <JsonCell value={event.payload} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export default function WebhooksPipedrivePage() {
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'short',
        timeStyle: 'medium',
      }),
    [],
  );

  const eventsQuery = useQuery({
    queryKey: ['reporting', 'pipedrive-webhooks'],
    queryFn: () => fetchPipedriveWebhookEvents({ limit: 200 }),
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
    const message = isApiError(eventsQuery.error)
      ? eventsQuery.error.message
      : 'No se pudieron cargar los eventos de webhook.';
    content = <Alert variant="danger">{message}</Alert>;
  } else if (events.length === 0) {
    content = <Alert variant="info">No hay eventos de webhook registrados.</Alert>;
  } else {
    content = <EventTable events={events} formatter={dateTimeFormatter} />;
  }

  return (
    <section className="py-3">
      <Card className="shadow-sm">
        <Card.Header as="h1" className="h4 mb-0">
          Webhooks Pipedrive
        </Card.Header>
        <Card.Body>
          <p className="text-muted">Registro de los eventos recibidos desde Pipedrive.</p>
          {content}
        </Card.Body>
      </Card>
    </section>
  );
}
