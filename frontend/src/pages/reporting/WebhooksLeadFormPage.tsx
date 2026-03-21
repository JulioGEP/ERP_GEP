import { Fragment, useMemo, useState } from 'react';
import { Alert, Card, Spinner, Table } from 'react-bootstrap';
import { useQuery } from '@tanstack/react-query';
import { fetchLeadFormWebhooks, type LeadFormWebhookEvent } from '../../features/reporting/api';
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
    <pre className="small mb-0 text-break bg-light p-3 rounded" style={{ whiteSpace: 'pre-wrap' }}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function EventTable({ events, formatter }: { events: LeadFormWebhookEvent[]; formatter: Intl.DateTimeFormat }) {
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const handleRowClick = (eventId: string) => {
    setExpandedEventId((currentId) => (currentId === eventId ? null : eventId));
  };

  const columnCount = 8;

  return (
    <div className="table-responsive">
      <Table striped bordered hover size="sm" className="align-middle">
        <thead>
          <tr>
            <th style={{ minWidth: 160 }}>Fecha</th>
            <th>Web</th>
            <th>Formulario</th>
            <th>Lead</th>
            <th>Email</th>
            <th>Teléfono</th>
            <th>Mensaje</th>
            <th>Evento</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const isExpanded = expandedEventId === event.id;
            return (
              <Fragment key={event.id}>
                <tr role="button" className="table-row-button" onClick={() => handleRowClick(event.id)}>
                  <td className="text-nowrap">{formatTimestamp(event.createdAt, formatter)}</td>
                  <td>{event.source ?? '—'}</td>
                  <td>
                    <div className="fw-semibold">{event.formName ?? '—'}</div>
                    {event.entryId ? <div className="text-muted small">Entry: {event.entryId}</div> : null}
                  </td>
                  <td>{event.leadName ?? '—'}</td>
                  <td>{event.leadEmail ?? '—'}</td>
                  <td>{event.leadPhone ?? '—'}</td>
                  <td style={{ maxWidth: 320 }}>
                    <div className="text-truncate">{event.leadMessage ?? '—'}</div>
                  </td>
                  <td>{event.eventName ?? '—'}</td>
                </tr>
                {isExpanded ? (
                  <tr>
                    <td colSpan={columnCount}>
                      <div className="fw-semibold mb-2">Headers del request</div>
                      <JsonCell value={event.requestHeaders} />
                      <div className="fw-semibold mt-3 mb-2">Payload completo del webhook</div>
                      <JsonCell value={event.payload} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}

export default function WebhooksLeadFormPage() {
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'short',
        timeStyle: 'medium',
      }),
    [],
  );

  const webhookUrl = useMemo(() => {
    if (typeof window === 'undefined') {
      return 'https://erpgep.netlify.app/api/lead-form-webhook';
    }

    return `${window.location.origin}/api/lead-form-webhook`;
  }, []);

  const eventsQuery = useQuery({
    queryKey: ['reporting', 'lead-form-webhooks'],
    queryFn: () => fetchLeadFormWebhooks({ limit: 200 }),
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
      : 'No se pudieron cargar los webhooks de leads.';
    content = <Alert variant="danger">{message}</Alert>;
  } else if (events.length === 0) {
    content = <Alert variant="info">Todavía no se ha recibido ningún webhook de formularios.</Alert>;
  } else {
    content = <EventTable events={events} formatter={dateTimeFormatter} />;
  }

  return (
    <section className="py-3">
      <Card className="shadow-sm mb-3">
        <Card.Header as="h1" className="h4 mb-0">
          Webhooks Lead Form
        </Card.Header>
        <Card.Body>
          <p className="text-muted mb-2">
            Usa esta URL en los WordPress para registrar los leads enviados por formulario.
          </p>
          <code className="d-block p-3 bg-light rounded text-break">{webhookUrl}</code>
          <p className="text-muted small mt-2 mb-0">
            Si queréis distinguir las dos webs, podéis añadir un query param como{' '}
            <code>?source=web1</code> o <code>?source=web2</code> en cada WordPress.
          </p>
        </Card.Body>
      </Card>

      <Card className="shadow-sm">
        <Card.Body>{content}</Card.Body>
      </Card>
    </section>
  );
}
