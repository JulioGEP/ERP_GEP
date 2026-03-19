import { Fragment, useMemo, useState } from 'react';
import { Alert, Badge, Card, Spinner, Table } from 'react-bootstrap';
import { useQuery } from '@tanstack/react-query';
import { isApiError } from '../../api/client';
import {
  fetchWooCommerceComprasWebhooks,
  type WooCommerceComprasWebhookEvent,
} from '../../features/reporting/api';

function formatTimestamp(value: string | null, formatter: Intl.DateTimeFormat): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
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

function WebhookTable({
  events,
  formatter,
}: {
  events: WooCommerceComprasWebhookEvent[];
  formatter: Intl.DateTimeFormat;
}) {
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const handleRowClick = (eventId: string) => {
    setExpandedEventId((currentId) => (currentId === eventId ? null : eventId));
  };

  return (
    <div className="table-responsive">
      <Table striped bordered hover size="sm" className="align-middle">
        <thead>
          <tr>
            <th style={{ minWidth: 160 }}>Fecha</th>
            <th>Pedido</th>
            <th>Estado</th>
            <th>Cliente</th>
            <th>Email</th>
            <th>Total</th>
            <th>Pago</th>
            <th>Origen</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const isExpanded = expandedEventId === event.id;
            return (
              <Fragment key={event.id}>
                <tr role="button" className="table-row-button" onClick={() => handleRowClick(event.id)}>
                  <td className="text-nowrap">{formatTimestamp(event.createdAt, formatter)}</td>
                  <td>
                    <div className="fw-semibold">{event.orderNumber ?? event.orderId ?? '—'}</div>
                    {event.orderId && event.orderNumber && event.orderId !== event.orderNumber ? (
                      <div className="text-muted small">ID: {event.orderId}</div>
                    ) : null}
                  </td>
                  <td>
                    <Badge bg="success">{event.orderStatus ?? '—'}</Badge>
                  </td>
                  <td>{event.customerName ?? '—'}</td>
                  <td>{event.customerEmail ?? '—'}</td>
                  <td>{event.orderTotal ? `${event.orderTotal} ${event.currency ?? ''}`.trim() : '—'}</td>
                  <td>{event.paymentMethod ?? '—'}</td>
                  <td>
                    <div>{event.source ?? '—'}</div>
                    <div className="text-muted small">{event.eventName ?? '—'}</div>
                  </td>
                </tr>
                {isExpanded ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="fw-semibold mb-2">Payload completo del webhook</div>
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

export default function WoocommerceComprasPage() {
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'short',
        timeStyle: 'medium',
      }),
    [],
  );

  const eventsQuery = useQuery({
    queryKey: ['reporting', 'woocommerce-compras-webhooks'],
    queryFn: () => fetchWooCommerceComprasWebhooks({ limit: 200 }),
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
      : 'No se pudieron cargar los webhooks de WooCommerce.';
    content = <Alert variant="danger">{message}</Alert>;
  } else if (!events.length) {
    content = <Alert variant="info">Todavía no se ha recibido ningún webhook de pedidos completados.</Alert>;
  } else {
    content = <WebhookTable events={events} formatter={dateTimeFormatter} />;
  }

  return (
    <section className="py-3">
      <Card className="shadow-sm">
        <Card.Header as="h1" className="h4 mb-0">
          WooCommerce Compras
        </Card.Header>
        <Card.Body>
          <p className="text-muted mb-2">
            Registro de pedidos completados recibidos desde el webhook nativo de WooCommerce.
          </p>
          <p className="small text-muted mb-4">
            Endpoint de recepción: <code>https://erpgep.netlify.app/api/woocommerce-compras-webhook</code>. Configura en WooCommerce el campo <code>Secret</code> con el token compartido para que la cabecera <code>X-WC-Webhook-Signature</code> se valide automáticamente.
          </p>
          {content}
        </Card.Body>
      </Card>
    </section>
  );
}
