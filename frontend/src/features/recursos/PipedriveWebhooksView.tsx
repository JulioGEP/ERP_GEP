import { useMemo } from 'react';
import { Alert, Button, Spinner, Table } from 'react-bootstrap';
import { useQuery } from '@tanstack/react-query';
import {
  PIPEDRIVE_WEBHOOKS_QUERY_KEY,
  fetchPipedriveWebhooks,
  type PipedriveWebhookEntry,
} from './pipedrive-webhooks.api';

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(date);
}

function PayloadCell({ payload }: { payload: unknown }) {
  const content = useMemo(() => {
    try {
      return JSON.stringify(payload, null, 2);
    } catch (error) {
      console.error('[pipedrive-webhooks] Error stringifying payload', error);
      return 'No se pudo mostrar el contenido';
    }
  }, [payload]);

  return (
    <pre className="small mb-0" style={{ whiteSpace: 'pre-wrap' }}>
      {content || '—'}
    </pre>
  );
}

function WebhookRow({ entry }: { entry: PipedriveWebhookEntry }) {
  return (
    <tr>
      <td className="align-middle text-break">{entry.request_uuid}</td>
      <td className="align-middle text-break">{entry.id}</td>
      <td className="align-middle">{formatDateTime(entry.received_at)}</td>
      <td className="align-middle">{formatDateTime(entry.updated_at)}</td>
      <td className="align-middle">
        <PayloadCell payload={entry.payload} />
      </td>
    </tr>
  );
}

export function PipedriveWebhooksView() {
  const query = useQuery<PipedriveWebhookEntry[], Error>({
    queryKey: PIPEDRIVE_WEBHOOKS_QUERY_KEY,
    queryFn: fetchPipedriveWebhooks,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return (
    <div className="container-fluid py-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <h2 className="mb-0">Pipedrive Webhooks</h2>
          <p className="text-muted mb-0">Últimas peticiones recibidas del webhook de Pipedrive.</p>
        </div>
        <Button variant="outline-primary" onClick={() => query.refetch()} disabled={query.isFetching}>
          {query.isFetching ? 'Actualizando…' : 'Actualizar'}
        </Button>
      </div>

      {query.isLoading ? (
        <div className="d-flex align-items-center gap-2 text-muted">
          <Spinner animation="border" size="sm" />
          Cargando webhooks…
        </div>
      ) : query.isError ? (
        <Alert variant="danger">
          {query.error?.message ?? 'No se pudieron cargar los webhooks.'}
        </Alert>
      ) : query.data.length === 0 ? (
        <Alert variant="info">Todavía no hay registros de webhooks.</Alert>
      ) : (
        <div className="table-responsive">
          <Table bordered hover size="sm">
            <thead>
              <tr>
                <th style={{ minWidth: 180 }}>UUID de petición</th>
                <th style={{ minWidth: 180 }}>ID interno</th>
                <th style={{ minWidth: 180 }}>Recibido</th>
                <th style={{ minWidth: 180 }}>Actualizado</th>
                <th>JSON</th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((entry) => (
                <WebhookRow key={entry.id} entry={entry} />
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}

export default PipedriveWebhooksView;
