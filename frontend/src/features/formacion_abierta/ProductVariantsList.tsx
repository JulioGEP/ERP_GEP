import { useEffect, useState } from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  ListGroup,
  Modal,
  Spinner,
  Stack,
} from 'react-bootstrap';

import { API_BASE, ApiError } from '../presupuestos/api';

type VariantInfo = {
  id: string;
  id_woo: string;
  name: string | null;
  status: string | null;
  price: string | null;
  stock: number | null;
  stock_status: string | null;
  sede: string | null;
  date: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ProductInfo = {
  id: string;
  id_woo: string | null;
  name: string | null;
  code: string | null;
  category: string | null;
  variants: VariantInfo[];
};

type ActiveVariant = {
  product: ProductInfo;
  variant: VariantInfo;
};

type ProductsVariantsResponse = {
  ok?: boolean;
  products?: ProductInfo[];
  message?: string;
};

type DeleteVariantResponse = {
  ok?: boolean;
  message?: string;
  error_code?: string;
};

const dateFormatter = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const currencyFormatter = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 2,
});

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return dateFormatter.format(date);
}

function formatPrice(value: string | null) {
  if (!value) return null;
  const amount = Number(value);
  if (Number.isNaN(amount)) return value;
  return currencyFormatter.format(amount);
}

async function fetchProductsWithVariants(): Promise<ProductInfo[]> {
  const response = await fetch(`${API_BASE}/products-variants`, {
    headers: { Accept: 'application/json' },
  });
  const text = await response.text();
  const json: ProductsVariantsResponse = text ? JSON.parse(text) : {};

  if (!response.ok || json.ok === false) {
    const message = json.message || 'No se pudieron obtener las variantes.';
    throw new ApiError('FETCH_ERROR', message, response.status || undefined);
  }

  const products = Array.isArray(json.products) ? json.products : [];

  return products.map((product) => ({
    id: product.id,
    id_woo: product.id_woo != null ? String(product.id_woo) : null,
    name: product.name ?? null,
    code: product.code ?? null,
    category: product.category ?? null,
    variants: Array.isArray(product.variants)
      ? product.variants.map((variant) => {
          const stockValue =
            typeof variant.stock === 'number'
              ? variant.stock
              : variant.stock != null && !Number.isNaN(Number(variant.stock))
                ? Number(variant.stock)
                : null;

          return {
            id: variant.id,
            id_woo: String(variant.id_woo),
            name: variant.name ?? null,
            status: variant.status ?? null,
            price: variant.price != null ? String(variant.price) : null,
            stock: stockValue,
            stock_status: variant.stock_status ?? null,
            sede: variant.sede ?? null,
            date: variant.date ?? null,
            created_at: variant.created_at ?? null,
            updated_at: variant.updated_at ?? null,
          };
        })
      : [],
  }));
}

async function deleteProductVariant(variantId: string): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/products-variants/${encodeURIComponent(variantId)}`, {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    throw new ApiError('NETWORK_ERROR', 'No se pudo conectar con el servidor.', undefined);
  }

  const text = await response.text();
  let json: DeleteVariantResponse = {};

  if (text) {
    try {
      json = JSON.parse(text);
    } catch (error) {
      console.error('[deleteProductVariant] invalid JSON response', error);
      json = {};
    }
  }

  if (!response.ok || json.ok === false) {
    const message = json.message || 'No se pudo eliminar la variante.';
    throw new ApiError(json.error_code ?? 'DELETE_ERROR', message, response.status || undefined);
  }

  return json.message ?? null;
}

type VariantSortKey = {
  location: string | null;
  year: number | null;
  month: number | null;
  day: number | null;
};

function extractVariantSortKey(variant: VariantInfo): VariantSortKey {
  const name = variant.name?.trim() ?? '';
  const dateMatch = name.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);

  let locationSegment = name;
  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;

  if (dateMatch) {
    const [, dayText, monthText, yearText] = dateMatch;
    const parsedDay = Number.parseInt(dayText ?? '', 10);
    const parsedMonth = Number.parseInt(monthText ?? '', 10);
    let parsedYear = Number.parseInt(yearText ?? '', 10);

    day = Number.isFinite(parsedDay) ? parsedDay : null;
    month = Number.isFinite(parsedMonth) ? parsedMonth : null;

    if (Number.isFinite(parsedYear)) {
      if (yearText && yearText.length === 2) {
        parsedYear += parsedYear < 50 ? 2000 : 1900;
      }
      year = parsedYear;
    }

    const index = dateMatch.index ?? -1;
    if (index >= 0) {
      locationSegment = name.slice(0, index);
    }
  }

  let location = locationSegment.replace(/[\s,.;:-]+$/u, '').trim();
  if (!location) {
    location = variant.sede?.trim() ?? '';
  }
  if (!location && name) {
    location = name;
  }

  return {
    location: location || null,
    year,
    month,
    day,
  };
}

function compareNullableStrings(a: string | null, b: string | null): number {
  const hasA = !!(a && a.trim().length);
  const hasB = !!(b && b.trim().length);
  if (hasA && hasB) {
    return a!.trim().localeCompare(b!.trim(), 'es', { sensitivity: 'base' });
  }
  if (hasA) return -1;
  if (hasB) return 1;
  return 0;
}

function compareNullableNumbers(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareVariants(a: VariantInfo, b: VariantInfo): number {
  const keyA = extractVariantSortKey(a);
  const keyB = extractVariantSortKey(b);

  const locationCompare = compareNullableStrings(keyA.location, keyB.location);
  if (locationCompare !== 0) return locationCompare;

  const yearCompare = compareNullableNumbers(keyA.year, keyB.year);
  if (yearCompare !== 0) return yearCompare;

  const monthCompare = compareNullableNumbers(keyA.month, keyB.month);
  if (monthCompare !== 0) return monthCompare;

  const dayCompare = compareNullableNumbers(keyA.day, keyB.day);
  if (dayCompare !== 0) return dayCompare;

  return (a.name ?? '').localeCompare(b.name ?? '', 'es', { sensitivity: 'base' });
}

function VariantModal({ active, onHide }: { active: ActiveVariant | null; onHide: () => void }) {
  const variant = active?.variant;
  const product = active?.product;

  return (
    <Modal show={!!variant} onHide={onHide} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Detalle de la variante</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {variant && product ? (
          <Stack gap={3}>
            <div>
              <p className="text-uppercase text-muted small fw-semibold mb-1">Producto</p>
              <div className="fw-semibold">{product.name ?? 'Producto sin nombre'}</div>
              <div className="text-muted small">ID Woo: {product.id_woo ?? '—'}</div>
              {product.code && <div className="text-muted small">Código: {product.code}</div>}
              {product.category && <div className="text-muted small">Categoría: {product.category}</div>}
            </div>

            <div>
              <p className="text-uppercase text-muted small fw-semibold mb-2">Variante</p>
              <Stack direction="horizontal" gap={2} className="flex-wrap mb-2">
                <span className="fw-semibold h5 mb-0">{variant.name ?? 'Variante sin nombre'}</span>
                {variant.status && <Badge bg="info">{variant.status}</Badge>}
              </Stack>
              <div className="text-muted small">ID Woo: {variant.id_woo}</div>
            </div>

            <dl className="row mb-0">
              <dt className="col-sm-4 text-muted">Precio</dt>
              <dd className="col-sm-8">{formatPrice(variant.price) ?? '—'}</dd>

              <dt className="col-sm-4 text-muted">Stock</dt>
              <dd className="col-sm-8">{variant.stock ?? '—'}</dd>

              <dt className="col-sm-4 text-muted">Estado de stock</dt>
              <dd className="col-sm-8">{variant.stock_status ?? '—'}</dd>

              <dt className="col-sm-4 text-muted">Sede</dt>
              <dd className="col-sm-8">{variant.sede ?? '—'}</dd>

              <dt className="col-sm-4 text-muted">Fecha</dt>
              <dd className="col-sm-8">{formatDate(variant.date) ?? '—'}</dd>

              <dt className="col-sm-4 text-muted">Creada</dt>
              <dd className="col-sm-8">{formatDate(variant.created_at) ?? '—'}</dd>

              <dt className="col-sm-4 text-muted">Actualizada</dt>
              <dd className="col-sm-8">{formatDate(variant.updated_at) ?? '—'}</dd>
            </dl>
          </Stack>
        ) : null}
      </Modal.Body>
    </Modal>
  );
}

export default function ProductVariantsList() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [activeVariant, setActiveVariant] = useState<ActiveVariant | null>(null);
  const [pendingDeletes, setPendingDeletes] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    let ignore = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await fetchProductsWithVariants();
        if (!ignore) {
          setProducts(data);
        }
      } catch (err) {
        if (!ignore) {
          const message = err instanceof ApiError ? err.message : 'Error inesperado al cargar las variantes.';
          setError(message);
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      ignore = true;
    };
  }, []);

  const handleSelectVariant = (product: ProductInfo, variant: VariantInfo) => {
    setActiveVariant({ product, variant });
  };

  const handleCloseModal = () => setActiveVariant(null);

  const setVariantDeleting = (variantId: string, deleting: boolean) => {
    setPendingDeletes((prev) => {
      const next = { ...prev };
      if (deleting) {
        next[variantId] = true;
      } else {
        delete next[variantId];
      }
      return next;
    });
  };

  const handleDeleteVariant = async (product: ProductInfo, variant: VariantInfo) => {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('¿Quieres eliminar esta variante? Esta acción no se puede deshacer.');
      if (!confirmed) {
        return;
      }
    }

    setFeedback(null);
    setVariantDeleting(variant.id, true);

    try {
      const message = await deleteProductVariant(variant.id);

      setProducts((prev) =>
        prev.map((item) =>
          item.id === product.id
            ? { ...item, variants: item.variants.filter((current) => current.id !== variant.id) }
            : item,
        ),
      );

      if (activeVariant?.variant.id === variant.id) {
        setActiveVariant(null);
      }

      setFeedback({
        tone: 'success',
        text: message ?? 'Variante eliminada correctamente.',
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'No se pudo eliminar la variante.';
      setFeedback({ tone: 'danger', text: message });
    } finally {
      setVariantDeleting(variant.id, false);
    }
  };

  return (
    <>
      <Card className="border-0 shadow-sm">
        <Card.Body className="d-flex flex-column gap-4">
          <div>
            <h2 className="h5 mb-1">Productos con variantes</h2>
            <p className="text-muted mb-0">
              Consulta las variantes sincronizadas para los productos asociados a WooCommerce y revisa su detalle.
            </p>
          </div>

          {feedback ? (
            <Alert
              variant={feedback.tone}
              dismissible
              onClose={() => setFeedback(null)}
              className="mb-0"
            >
              {feedback.text}
            </Alert>
          ) : null}

          {error ? (
            <Alert variant="danger" className="mb-0">
              {error}
            </Alert>
          ) : null}

          {isLoading ? (
            <div className="d-flex align-items-center gap-2 text-muted small">
              <Spinner animation="border" size="sm" role="status" aria-hidden="true" />
              <span>Cargando productos…</span>
            </div>
          ) : null}

          {!isLoading && !error ? (
            products.length > 0 ? (
              <Accordion alwaysOpen>
                {products.map((product) => (
                  <Accordion.Item eventKey={product.id} key={product.id}>
                    <Accordion.Header>
                      <div className="d-flex flex-column">
                        <span className="fw-semibold">{product.name ?? 'Producto sin nombre'}</span>
                        <small className="text-muted">ID Woo: {product.id_woo ?? '—'}</small>
                      </div>
                    </Accordion.Header>
                    <Accordion.Body>
                      {product.variants.length > 0 ? (
                        <ListGroup>
                          {[...product.variants].sort(compareVariants).map((variant) => {
                            const isDeleting = !!pendingDeletes[variant.id];

                            return (
                              <ListGroup.Item
                                action
                                key={variant.id}
                                onClick={() => handleSelectVariant(product, variant)}
                                className="d-flex flex-column gap-1"
                              >
                                <div className="d-flex justify-content-between align-items-start gap-3">
                                  <div>
                                    <div className="fw-semibold">{variant.name ?? 'Variante sin nombre'}</div>
                                    <div className="text-muted small">ID Woo: {variant.id_woo}</div>
                                  </div>
                                  <Stack direction="horizontal" gap={2} className="flex-wrap">
                                    {variant.status && <Badge bg="info">{variant.status}</Badge>}
                                    {variant.date && (
                                      <span className="text-muted small">{formatDate(variant.date)}</span>
                                    )}
                                    <Button
                                      size="sm"
                                      variant="outline-danger"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        handleDeleteVariant(product, variant);
                                      }}
                                      disabled={isDeleting}
                                    >
                                      {isDeleting ? (
                                        <>
                                          <Spinner
                                            as="span"
                                            animation="border"
                                            size="sm"
                                            role="status"
                                            aria-hidden="true"
                                            className="me-2"
                                          />
                                          Eliminando…
                                        </>
                                      ) : (
                                        'Eliminar'
                                      )}
                                    </Button>
                                  </Stack>
                                </div>
                                {variant.sede && <div className="text-muted small">Sede: {variant.sede}</div>}
                              </ListGroup.Item>
                            );
                          })}
                        </ListGroup>
                      ) : (
                        <p className="text-muted small mb-0">No hay variantes registradas para este producto.</p>
                      )}
                    </Accordion.Body>
                  </Accordion.Item>
                ))}
              </Accordion>
            ) : (
              <p className="text-muted small mb-0">No hay productos con variantes sincronizadas.</p>
            )
          ) : null}
        </Card.Body>
      </Card>

      <VariantModal active={activeVariant} onHide={handleCloseModal} />
    </>
  );
}
