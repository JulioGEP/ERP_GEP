// frontend/src/features/formacion_abierta/CursosWoo.tsx
import { FormEvent, useMemo, useState } from 'react';
import { Button, Card, Form, Stack } from 'react-bootstrap';
import { API_BASE, ApiError, isApiError } from '../presupuestos/api';

type WooResponse = {
  ok?: boolean;
  data?: unknown;
  status?: number;
  message?: string;
  error_code?: string;
};

type FetchErrorState = {
  status?: number;
};

function buildEndpoint(resource: string, params?: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  search.set('resource', resource);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      search.set(key, String(value));
    }
  }

  const query = search.toString();
  return `${API_BASE}/woo_courses${query ? `?${query}` : ''}`;
}

async function requestWooResource(resource: string, params?: Record<string, string | number | undefined>) {
  const endpoint = buildEndpoint(resource, params);
  const response = await fetch(endpoint);
  const text = await response.text();
  let json: WooResponse = {};

  if (text) {
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new ApiError('INVALID_RESPONSE', 'Respuesta JSON inválida del servidor', response.status);
    }
  }

  if (!response.ok || json.ok === false) {
    const status = json.status ?? response.status;
    const message = json.message ?? 'Error inesperado al cargar datos';
    throw new ApiError(json.error_code ?? `HTTP_${status}`, message, status);
  }

  return json.data ?? null;
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  return JSON.stringify(value, null, 2);
}

export default function CursosWoo() {
  const [productId, setProductId] = useState('');
  const [parentData, setParentData] = useState<unknown | null>(null);
  const [variationsData, setVariationsData] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<FetchErrorState | null>(null);
  const [hasFetched, setHasFetched] = useState(false);

  const parentJson = useMemo(() => formatJson(parentData), [parentData]);
  const variationsJson = useMemo(() => {
    if (Array.isArray(variationsData)) {
      return formatJson(variationsData);
    }

    return formatJson([]);
  }, [variationsData]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedId = productId.trim();
    if (!trimmedId) {
      setError(null);
      setParentData(null);
      setVariationsData(null);
      setHasFetched(false);
      return;
    }

    const encodedId = encodeURIComponent(trimmedId);

    setIsLoading(true);
    setError(null);

    try {
      const parentPromise = requestWooResource(`products/${encodedId}`);
      let variationsResult: unknown = [];

      try {
        const variationsRaw = await requestWooResource(`products/${encodedId}/variations`, {
          per_page: 100,
        });
        variationsResult = Array.isArray(variationsRaw) ? variationsRaw : [];
      } catch (err) {
        if (isApiError(err) && err.status === 404) {
          variationsResult = [];
        } else {
          throw err;
        }
      }

      const parentResult = await parentPromise;

      setParentData(parentResult);
      setVariationsData(variationsResult);
      setHasFetched(true);
    } catch (err) {
      setParentData(null);
      setVariationsData(null);
      setHasFetched(true);

      if (isApiError(err)) {
        setError({ status: err.status });
      } else {
        setError({});
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <Card.Body className="d-flex flex-column gap-3">
        <div>
          <h2 className="h5 mb-1">Importar producto de WooCommerce</h2>
          <p className="text-muted mb-0">Introduce un ID de producto para consultar su información y variaciones.</p>
        </div>

        <Form onSubmit={handleSubmit}>
          <Stack direction="horizontal" gap={2} className="flex-wrap">
            <Form.Control
              type="text"
              value={productId}
              onChange={(event) => setProductId(event.currentTarget.value)}
              placeholder="ID de producto"
              style={{ maxWidth: '220px' }}
            />
            <Button type="submit" variant="primary" disabled={isLoading}>
              Importar
            </Button>
          </Stack>
        </Form>

        {isLoading && <p className="text-muted mb-0">Cargando…</p>}

        {!isLoading && error && (
          <p className="text-danger mb-0">
            Error al cargar{error.status ? ` (status ${error.status})` : ''}
          </p>
        )}

        {!isLoading && !error && !hasFetched && <p className="text-muted mb-0">Sin datos.</p>}

        {!isLoading && !error && hasFetched && (
          <div className="d-flex flex-column gap-3">
            <section>
              <h3 className="h6 mb-2">Producto</h3>
              {parentData ? (
                <pre className="bg-light border rounded p-3 small mb-0">
                  {parentJson}
                </pre>
              ) : (
                <p className="text-muted mb-0">Sin datos.</p>
              )}
            </section>

            <section>
              <h3 className="h6 mb-2">Variaciones</h3>
              <pre className="bg-light border rounded p-3 small mb-0">
                {variationsJson}
              </pre>
            </section>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
