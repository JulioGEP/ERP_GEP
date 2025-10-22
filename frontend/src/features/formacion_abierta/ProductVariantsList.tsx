import { useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  Alert,
  Badge,
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

  const defaultActiveKey = useMemo(() => (products.length > 0 ? products[0].id : undefined), [products]);

  const handleSelectVariant = (product: ProductInfo, variant: VariantInfo) => {
    setActiveVariant({ product, variant });
  };

  const handleCloseModal = () => setActiveVariant(null);

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

          {error ? (
            <Alert variant="danger" className="mb-0">
              {error}
            </Alert>
          ) : null}

          {isLoading ? (
            <div className="d-flex align-items-center gap-2 text-muted small">
              <Spinner animation="border" size="sm" role="status" aria-hidden />
              <span>Cargando productos…</span>
            </div>
          ) : null}

          {!isLoading && !error ? (
            products.length > 0 ? (
              <Accordion alwaysOpen defaultActiveKey={defaultActiveKey ? [defaultActiveKey] : undefined}>
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
                          {product.variants.map((variant) => (
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
                                </Stack>
                              </div>
                              {variant.sede && <div className="text-muted small">Sede: {variant.sede}</div>}
                            </ListGroup.Item>
                          ))}
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
