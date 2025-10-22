import { useCallback, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, ListGroup, Spinner, Stack } from 'react-bootstrap';

import { API_BASE, ApiError } from '../presupuestos/api';

export type VariationsSyncLogEntry = {
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  productWooId?: string | null;
  productName?: string | null;
};

export type VariationsSyncChange = {
  id_woo: string;
  name: string | null;
  changes?: string[];
};

export type VariationsSyncProductReport = {
  productId: string;
  productWooId: string;
  productName: string | null;
  fetchedVariations: number;
  validVariations: number;
  skippedVariations: number;
  added: VariationsSyncChange[];
  updated: VariationsSyncChange[];
  removed: VariationsSyncChange[];
  error?: string;
};

export type VariationsSyncSummary = {
  totalProducts: number;
  processedProducts: number;
  failedProducts: number;
  totals: {
    added: number;
    updated: number;
    removed: number;
  };
  products: VariationsSyncProductReport[];
};

export type VariationsSyncResponse = {
  ok?: boolean;
  logs?: VariationsSyncLogEntry[];
  summary?: VariationsSyncSummary;
};

async function requestJson(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, init);
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  if (!response.ok || (json && typeof json === 'object' && (json as any).ok === false)) {
    const message =
      json && typeof json === 'object' && typeof (json as any).message === 'string'
        ? (json as any).message
        : 'Error al sincronizar las variantes';
    const status = response.status || (json && typeof (json as any).status === 'number'
      ? (json as any).status
      : undefined);
    throw new ApiError('SYNC_ERROR', message, status);
  }

  return (json || {}) as VariationsSyncResponse;
}

function formatChangeSummary(changes: VariationsSyncChange[]): string {
  return changes
    .map((change) => {
      const fields = Array.isArray(change.changes) && change.changes.length > 0
        ? ` (${change.changes.join(', ')})`
        : '';
      return `${change.name ?? '—'}${fields}`;
    })
    .join('; ');
}

function getLogVariant(type: VariationsSyncLogEntry['type']): string {
  switch (type) {
    case 'success':
      return 'success';
    case 'warning':
      return 'warning';
    case 'error':
      return 'danger';
    default:
      return 'secondary';
  }
}

export default function VariationsSync() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<VariationsSyncLogEntry[]>([]);
  const [summary, setSummary] = useState<VariationsSyncSummary | null>(null);

  const handleSync = useCallback(async () => {
    if (isSyncing) return;

    setIsSyncing(true);
    setError(null);
    setLogs([]);
    setSummary(null);

    try {
      const json = await requestJson(`${API_BASE}/woo_courses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      setLogs(json.logs ?? []);
      setSummary(json.summary ?? null);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError('Respuesta inválida del servidor.');
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('No se pudo completar la sincronización.');
      }
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing]);

  const totalsLabel = useMemo(() => {
    if (!summary) return '';
    const { added, updated, removed } = summary.totals;
    return `Variantes añadidas: ${added} · actualizadas: ${updated} · eliminadas: ${removed}`;
  }, [summary]);

  return (
    <Card className="border-0 shadow-sm">
      <Card.Body className="d-flex flex-column gap-4">
        <div>
          <h2 className="h5 mb-1">Sincronizar variaciones</h2>
          <p className="text-muted mb-0">
            Consulta los productos con ID de WooCommerce asociados y sincroniza sus variaciones con la base de datos.
          </p>
        </div>

        <Stack direction="horizontal" gap={2} className="flex-wrap">
          <Button onClick={handleSync} disabled={isSyncing}>
            {isSyncing ? (
              <>
                <Spinner
                  animation="border"
                  size="sm"
                  className="me-2"
                  role="status"
                  aria-hidden
                />
                Sincronizando…
              </>
            ) : (
              'Sincronizar Variantes'
            )}
          </Button>
        </Stack>

        {error && (
          <Alert variant="danger" className="mb-0">
            {error}
          </Alert>
        )}

        {summary && (
          <Alert variant="success" className="mb-0">
            <div className="fw-semibold">Sincronización completada</div>
            <div className="small mb-1">
              Productos analizados: {summary.processedProducts} de {summary.totalProducts}.{' '}
              {summary.failedProducts > 0 && `Errores: ${summary.failedProducts}.`}
            </div>
            <div className="small mb-0">{totalsLabel}</div>
          </Alert>
        )}

        {logs.length > 0 && (
          <section className="d-flex flex-column gap-2">
            <h3 className="h6 mb-0">Registro de sincronización</h3>
            <ListGroup className="small">
              {logs.map((log, index) => (
                <ListGroup.Item key={`log-${index}`} className="d-flex flex-column gap-1">
                  <div className="d-flex align-items-center gap-2">
                    <Badge bg={getLogVariant(log.type)}>{log.type.toUpperCase()}</Badge>
                    <span>{log.message}</span>
                  </div>
                  {(log.productWooId || log.productName) && (
                    <div className="text-muted">
                      {log.productName ? `${log.productName} · ` : ''}ID Woo: {log.productWooId ?? '—'}
                    </div>
                  )}
                </ListGroup.Item>
              ))}
            </ListGroup>
          </section>
        )}

        {summary?.products.length ? (
          <section className="d-flex flex-column gap-3">
            <h3 className="h6 mb-0">Resultados por producto</h3>
            <div className="d-flex flex-column gap-3">
              {summary.products.map((product) => (
                <Card key={product.productId} className="border border-light-subtle">
                  <Card.Body className="d-flex flex-column gap-2">
                    <div className="d-flex flex-column">
                      <span className="fw-semibold">{product.productName ?? 'Producto sin nombre'}</span>
                      <span className="text-muted small">ID Woo: {product.productWooId}</span>
                    </div>

                    {product.error ? (
                      <Alert variant="warning" className="mb-0">
                        No se pudo sincronizar este producto. {product.error}
                      </Alert>
                    ) : (
                      <div className="d-flex flex-column gap-2 small">
                        <div>
                          Variaciones en WooCommerce: {product.fetchedVariations}. Válidas: {product.validVariations}.{' '}
                          {product.skippedVariations > 0 && `Omitidas: ${product.skippedVariations}.`}
                        </div>
                        <div className="d-flex flex-column gap-1">
                          <span>
                            Añadidas: {product.added.length}{' '}
                            {product.added.length > 0 && `→ ${formatChangeSummary(product.added)}`}
                          </span>
                          <span>
                            Actualizadas: {product.updated.length}{' '}
                            {product.updated.length > 0 && `→ ${formatChangeSummary(product.updated)}`}
                          </span>
                          <span>
                            Eliminadas: {product.removed.length}{' '}
                            {product.removed.length > 0 &&
                              `→ ${product.removed.map((variant) => variant.name ?? '—').join('; ')}`}
                          </span>
                        </div>
                      </div>
                    )}
                  </Card.Body>
                </Card>
              ))}
            </div>
          </section>
        ) : null}
      </Card.Body>
    </Card>
  );
}
