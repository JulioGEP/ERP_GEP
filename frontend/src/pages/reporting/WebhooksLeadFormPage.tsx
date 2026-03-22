import { Fragment, useMemo, useState } from 'react';
import { Alert, Button, Card, Spinner, Table } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchLeadFormWebhooks,
  sendLeadFormWebhookToPipe,
  type LeadFormWebhookEvent,
  type SendLeadFormWebhookToPipeResult,
} from '../../features/reporting/api';
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

function resolveWebsiteLabel(headers: LeadFormWebhookEvent['requestHeaders']): string {
  const userAgent = typeof headers?.['user-agent'] === 'string' ? headers['user-agent'] : null;

  if (userAgent?.includes('https://gepcoformacion.es')) {
    return 'GEPCO';
  }

  if (userAgent?.includes('https://gepservices.es')) {
    return 'GEP Services';
  }

  return '—';
}

type LeadFormFeedback = {
  eventId: string;
  kind: 'success' | 'danger';
  title: string;
  result?: SendLeadFormWebhookToPipeResult;
  message?: string;
};

function buildFeedbackSummary(result: SendLeadFormWebhookToPipeResult): string {
  const parts = [
    `organización ${result.organizationCreated ? 'creada' : 'actualizada'}`,
    `persona ${result.personCreated ? 'creada' : 'actualizada'}`,
    `${result.recordType} ${result.recordCreated ? 'creado' : 'reutilizado'}`,
    result.productAdded ? 'producto añadido' : null,
    result.slackSent ? 'aviso enviado a Slack' : 'sin aviso Slack',
  ].filter((part): part is string => Boolean(part));

  return parts.join(' · ');
}

function EventTable({
  events,
  formatter,
  pendingEventId,
  onSendToPipe,
}: {
  events: LeadFormWebhookEvent[];
  formatter: Intl.DateTimeFormat;
  pendingEventId: string | null;
  onSendToPipe: (eventId: string) => void;
}) {
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const handleRowClick = (eventId: string) => {
    setExpandedEventId((currentId) => (currentId === eventId ? null : eventId));
  };

  const columnCount = 7;

  return (
    <div className="table-responsive">
      <Table striped bordered hover size="sm" className="align-middle">
        <thead>
          <tr>
            <th style={{ minWidth: 160 }}>Fecha</th>
            <th>Web</th>
            <th>Lead</th>
            <th>Email</th>
            <th>Mensaje</th>
            <th>Evento</th>
            <th style={{ minWidth: 160 }}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const isExpanded = expandedEventId === event.id;
            const isPending = pendingEventId === event.id;
            return (
              <Fragment key={event.id}>
                <tr role="button" className="table-row-button" onClick={() => handleRowClick(event.id)}>
                  <td className="text-nowrap">{formatTimestamp(event.createdAt, formatter)}</td>
                  <td>{resolveWebsiteLabel(event.requestHeaders)}</td>
                  <td>{event.leadName ?? '—'}</td>
                  <td>{event.leadEmail ?? '—'}</td>
                  <td style={{ maxWidth: 320 }}>
                    <div className="text-truncate">{event.leadMessage ?? '—'}</div>
                  </td>
                  <td>{event.eventName ?? '—'}</td>
                  <td>
                    <Button
                      size="sm"
                      variant="outline-primary"
                      disabled={isPending}
                      onClick={(buttonEvent) => {
                        buttonEvent.stopPropagation();
                        onSendToPipe(event.id);
                      }}
                    >
                      {isPending ? (
                        <>
                          <Spinner as="span" animation="border" size="sm" className="me-2" />
                          Procesando…
                        </>
                      ) : (
                        'Enviar al ERP'
                      )}
                    </Button>
                  </td>
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
  const queryClient = useQueryClient();
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'short',
        timeStyle: 'medium',
      }),
    [],
  );
  const [feedback, setFeedback] = useState<LeadFormFeedback | null>(null);

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

  const sendToPipeMutation = useMutation({
    mutationFn: sendLeadFormWebhookToPipe,
    onSuccess: (result, eventId) => {
      setFeedback({
        eventId,
        kind: 'success',
        title: 'Lead procesado en el ERP.',
        result,
      });
      queryClient.invalidateQueries({ queryKey: ['reporting', 'lead-form-webhooks'] });
    },
    onError: (error, eventId) => {
      const message = isApiError(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : 'No se pudo procesar el lead en el ERP.';
      setFeedback({
        eventId,
        kind: 'danger',
        title: 'No se pudo procesar el lead.',
        message,
      });
    },
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
    content = (
      <EventTable
        events={events}
        formatter={dateTimeFormatter}
        pendingEventId={sendToPipeMutation.isPending ? sendToPipeMutation.variables ?? null : null}
        onSendToPipe={(eventId) => {
          setFeedback(null);
          sendToPipeMutation.mutate(eventId);
        }}
      />
    );
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
            La columna <strong>Web</strong> se rellena automáticamente leyendo el dominio incluido en el header
            <code className="ms-1">user-agent</code> del WordPress.
          </p>
          <p className="text-muted small mt-2 mb-0">
            El botón <strong>Enviar al ERP</strong> ejecuta desde el ERP la lógica equivalente al flujo de Zapier
            para ese webhook: crea o actualiza los registros en Pipedrive y lanza la notificación a Slack.
          </p>
        </Card.Body>
      </Card>

      <Card className="shadow-sm">
        <Card.Body>
          {feedback ? (
            <Alert variant={feedback.kind} dismissible onClose={() => setFeedback(null)}>
              <Alert.Heading className="h6">{feedback.title}</Alert.Heading>
              {feedback.message ? <p className="mb-2">{feedback.message}</p> : null}
              {feedback.result ? <p className="mb-2">{buildFeedbackSummary(feedback.result)}</p> : null}
              {feedback.result?.warnings.length ? (
                <ul className="mb-0 ps-3">
                  {feedback.result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </Alert>
          ) : null}
          {content}
        </Card.Body>
      </Card>
    </section>
  );
}
