// frontend/src/features/formacion_abierta/CursosWoo.tsx
import { FormEvent, useState } from 'react';
import { Alert, Badge, Button, Card, Form, Stack } from 'react-bootstrap';
import { API_BASE, ApiError, isApiError } from '../presupuestos/api';

type VariationSyncResult = {
  ok?: boolean;
  count?: number;
  parent_id?: string | number | null;
  message?: string;
};

type WooResponse = {
  ok?: boolean;
  data?: unknown;
  status?: number;
  message?: string;
  error_code?: string;
  meta?: {
    stored_variations?: VariationSyncResult;
  };
};

type WooAttribute = {
  id?: number;
  name?: string;
  option?: string;
  options?: string[];
  slug?: string;
};

type WooProduct = {
  id?: number;
  name?: string;
  status?: string;
  price?: string;
  total_sales?: number;
  manage_stock?: boolean;
  stock_quantity?: number | null;
  attributes?: WooAttribute[];
  variations?: number[];
};

type WooVariation = {
  id?: number;
  price?: string;
  status?: string;
  stock_quantity?: number | null;
  stock_status?: string;
  parent_id?: number;
  name?: string;
  attributes?: WooAttribute[];
  date_created?: string;
  date_created_gmt?: string;
  date_modified?: string;
  date_modified_gmt?: string;
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

async function requestWooResource(
  resource: string,
  params?: Record<string, string | number | undefined>,
): Promise<WooResponse> {
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

  return json;
}

function normalizeText(value?: string) {
  if (!value) return '';
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getAttributeOptions(attribute?: WooAttribute): string[] {
  if (!attribute) return [];

  if (Array.isArray(attribute.options) && attribute.options.length > 0) {
    return attribute.options.map((option) => String(option));
  }

  if (attribute.option) {
    return [String(attribute.option)];
  }

  return [];
}

function findAttributeValues(attributes: WooAttribute[] | undefined, keywords: string[]): string[] {
  if (!attributes?.length) return [];

  const normalizedKeywords = keywords.map((keyword) => normalizeText(keyword));

  for (const attribute of attributes) {
    const normalizedName = normalizeText(attribute.name) || normalizeText(attribute.slug);

    if (!normalizedName) continue;

    const matches = normalizedKeywords.some((keyword) => normalizedName.includes(keyword));

    if (matches) {
      return getAttributeOptions(attribute);
    }
  }

  return [];
}

function findVariationAttribute(variation: WooVariation, keywords: string[]): string {
  const values = findAttributeValues(variation.attributes, keywords);
  return values[0] ?? '—';
}

export default function CursosWoo() {
  const [productId, setProductId] = useState('');
  const [productData, setProductData] = useState<WooProduct | null>(null);
  const [variationsData, setVariationsData] = useState<WooVariation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<FetchErrorState | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [syncStatus, setSyncStatus] = useState<VariationSyncResult | null>(null);

  const productLocations = findAttributeValues(productData?.attributes, ['localizacion', 'ubicacion']);
  const productDates = findAttributeValues(productData?.attributes, ['fecha']);
  const productPipedriveIds = findAttributeValues(productData?.attributes, ['pipedrive', 'pipe']);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedId = productId.trim();
    if (!trimmedId) {
      setError(null);
      setProductData(null);
      setVariationsData([]);
      setHasFetched(false);
      setSyncStatus(null);
      return;
    }

    const encodedId = encodeURIComponent(trimmedId);

    setIsLoading(true);
    setError(null);
    setSyncStatus(null);

    try {
      const parentPromise = requestWooResource(`products/${encodedId}`);
      let variationsResult: WooVariation[] = [];
      let variationsMeta: VariationSyncResult | null = null;

      try {
        const variationsRaw = await requestWooResource(`products/${encodedId}/variations`, {
          per_page: 100,
        });
        const variationsDataRaw = Array.isArray(variationsRaw.data)
          ? (variationsRaw.data as WooVariation[])
          : [];
        variationsResult = variationsDataRaw;
        variationsMeta = variationsRaw.meta?.stored_variations ?? null;
      } catch (err) {
        if (isApiError(err) && err.status === 404) {
          variationsResult = [];
        } else {
          throw err;
        }
      }

      const parentResult = await parentPromise;
      const parentData = parentResult?.data && typeof parentResult.data === 'object'
        ? (parentResult.data as WooProduct)
        : null;

      setProductData(parentData);
      setVariationsData(variationsResult);
      setSyncStatus(variationsMeta);
      setHasFetched(true);
    } catch (err) {
      setProductData(null);
      setVariationsData([]);
      setHasFetched(true);
      setSyncStatus(null);

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
              {productData ? (
                <div className="d-flex flex-column gap-3">
                  <dl className="row mb-0 small">
                    <dt className="col-sm-4 col-lg-3">ID</dt>
                    <dd className="col-sm-8 col-lg-9">{productData.id ?? '—'}</dd>

                    <dt className="col-sm-4 col-lg-3">Nombre</dt>
                    <dd className="col-sm-8 col-lg-9">{productData.name ?? '—'}</dd>

                    <dt className="col-sm-4 col-lg-3">Estado</dt>
                    <dd className="col-sm-8 col-lg-9">{productData.status ?? '—'}</dd>

                    <dt className="col-sm-4 col-lg-3">Precio</dt>
                    <dd className="col-sm-8 col-lg-9">{productData.price ?? '—'}</dd>

                    <dt className="col-sm-4 col-lg-3">Ventas totales</dt>
                    <dd className="col-sm-8 col-lg-9">{productData.total_sales ?? '—'}</dd>

                    <dt className="col-sm-4 col-lg-3">Gestiona stock</dt>
                    <dd className="col-sm-8 col-lg-9">
                      {productData.manage_stock === undefined
                        ? '—'
                        : productData.manage_stock
                        ? 'Sí'
                        : 'No'}
                    </dd>

                    <dt className="col-sm-4 col-lg-3">Stock disponible</dt>
                    <dd className="col-sm-8 col-lg-9">{productData.stock_quantity ?? '—'}</dd>

                    <dt className="col-sm-4 col-lg-3">Nº de variaciones</dt>
                    <dd className="col-sm-8 col-lg-9">{variationsData.length}</dd>
                  </dl>

                  <div>
                    <h4 className="h6">Atributos</h4>
                    <div className="d-flex flex-column gap-2">
                      <div>
                        <span className="d-block text-muted small mb-1">Localizaciones</span>
                        <div className="d-flex flex-wrap gap-2">
                          {productLocations.length ? (
                            productLocations.map((value) => (
                              <Badge bg="secondary" key={`loc-${value}`}>
                                {value}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-muted small">Sin datos</span>
                          )}
                        </div>
                      </div>

                      <div>
                        <span className="d-block text-muted small mb-1">Fechas</span>
                        <div className="d-flex flex-wrap gap-2">
                          {productDates.length ? (
                            productDates.map((value) => (
                              <Badge bg="info" key={`date-${value}`}>
                                {value}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-muted small">Sin datos</span>
                          )}
                        </div>
                      </div>

                      <div>
                        <span className="d-block text-muted small mb-1">ID de Pipedrive</span>
                        <div className="d-flex flex-wrap gap-2">
                          {productPipedriveIds.length ? (
                            productPipedriveIds.map((value) => (
                              <Badge bg="dark" key={`pipe-${value}`}>
                                {value}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-muted small">Sin datos</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-muted mb-0">Sin datos.</p>
              )}
            </section>

            <section>
              <h3 className="h6 mb-2">Variaciones</h3>
              {syncStatus && (
                <Alert
                  variant={syncStatus.ok === false ? 'warning' : 'success'}
                  className="mb-0"
                >
                  {syncStatus.message
                    ? syncStatus.message
                    : syncStatus.ok === false
                    ? 'No se pudieron guardar las variaciones en la base de datos.'
                    : 'Variaciones guardadas correctamente.'}
                  {typeof syncStatus.count === 'number'
                    ? ` (variaciones registradas: ${syncStatus.count})`
                    : null}
                </Alert>
              )}
              {variationsData.length ? (
                <div className="d-flex flex-column gap-3">
                  {variationsData.map((variation, index) => (
                    <div
                      key={variation.id ?? `variation-${index}`}
                      className="border rounded p-3 small bg-light"
                    >
                      <dl className="row mb-0">
                        <dt className="col-sm-5 col-lg-3">ID</dt>
                        <dd className="col-sm-7 col-lg-9">{variation.id ?? '—'}</dd>

                        <dt className="col-sm-5 col-lg-3">Nombre</dt>
                        <dd className="col-sm-7 col-lg-9">{variation.name ?? '—'}</dd>

                        <dt className="col-sm-5 col-lg-3">Estado</dt>
                        <dd className="col-sm-7 col-lg-9">{variation.status ?? '—'}</dd>

                        <dt className="col-sm-5 col-lg-3">Precio</dt>
                        <dd className="col-sm-7 col-lg-9">{variation.price ?? '—'}</dd>

                        <dt className="col-sm-5 col-lg-3">Stock disponible</dt>
                        <dd className="col-sm-7 col-lg-9">{variation.stock_quantity ?? '—'}</dd>

                        <dt className="col-sm-5 col-lg-3">Estado de stock</dt>
                        <dd className="col-sm-7 col-lg-9">{variation.stock_status ?? '—'}</dd>

                        <dt className="col-sm-5 col-lg-3">Localización</dt>
                        <dd className="col-sm-7 col-lg-9">
                          {findVariationAttribute(variation, ['localizacion', 'ubicacion'])}
                        </dd>

                        <dt className="col-sm-5 col-lg-3">Fechas</dt>
                        <dd className="col-sm-7 col-lg-9">
                          {findVariationAttribute(variation, ['fecha'])}
                        </dd>

                        <dt className="col-sm-5 col-lg-3">ID padre</dt>
                        <dd className="col-sm-7 col-lg-9">{variation.parent_id ?? '—'}</dd>
                      </dl>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted mb-0">Sin variaciones disponibles.</p>
              )}
            </section>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
