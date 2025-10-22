import { ChangeEvent, useEffect, useState } from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  Form,
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

type VariantUpdateResponse = {
  ok?: boolean;
  variant?: Partial<VariantInfo> | null;
  message?: string;
};

type VariantUpdatePayload = {
  price?: string | null;
  stock?: number | null;
  stock_status?: string | null;
  sede?: string | null;
  date?: string | null;
};

type DealsByVariationResponse = {
  ok?: boolean;
  deals?: Array<{ deal_id?: string | null; title?: string | null }>;
  message?: string;
};

type DealTag = {
  deal_id: string;
  title: string;
};

const dateFormatter = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return dateFormatter.format(date);
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

function normalizeVariantFromResponse(input: any, fallbackId: string): VariantInfo {
  const stockValue =
    typeof input?.stock === 'number'
      ? input.stock
      : input?.stock != null && !Number.isNaN(Number(input.stock))
        ? Number(input.stock)
        : null;

  return {
    id: String(input?.id ?? fallbackId),
    id_woo: input?.id_woo != null ? String(input.id_woo) : '',
    name: input?.name ?? null,
    status: input?.status ?? null,
    price: input?.price != null ? String(input.price) : null,
    stock: stockValue,
    stock_status: input?.stock_status ?? null,
    sede: input?.sede ?? null,
    date: input?.date ?? null,
    created_at: input?.created_at ?? null,
    updated_at: input?.updated_at ?? null,
  };
}

async function updateProductVariant(
  variantId: string,
  updates: VariantUpdatePayload,
): Promise<VariantInfo> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}/products-variants/${encodeURIComponent(variantId)}`, {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });
  } catch (error) {
    throw new ApiError('NETWORK_ERROR', 'No se pudo conectar con el servidor.', undefined);
  }

  const text = await response.text();
  let json: VariantUpdateResponse = {};

  if (text) {
    try {
      json = JSON.parse(text) as VariantUpdateResponse;
    } catch (error) {
      console.error('[updateProductVariant] invalid JSON response', error);
      json = {};
    }
  }

  if (!response.ok || json.ok === false || !json.variant) {
    const message = json.message || 'No se pudo actualizar la variante.';
    throw new ApiError('UPDATE_ERROR', message, response.status || undefined);
  }

  return normalizeVariantFromResponse(json.variant, variantId);
}

async function fetchDealsByVariation(variationWooId: string): Promise<DealTag[]> {
  let response: Response;
  const url = `${API_BASE}/deals?w_id_variation=${encodeURIComponent(variationWooId)}`;

  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (error) {
    throw new ApiError('NETWORK_ERROR', 'No se pudo conectar con el servidor.', undefined);
  }

  const text = await response.text();
  let json: DealsByVariationResponse = {};

  if (text) {
    try {
      json = JSON.parse(text) as DealsByVariationResponse;
    } catch (error) {
      console.error('[fetchDealsByVariation] invalid JSON response', error);
      json = {};
    }
  }

  if (!response.ok || json.ok === false) {
    const message = json.message || 'No se pudieron obtener los deals.';
    throw new ApiError('FETCH_ERROR', message, response.status || undefined);
  }

  const deals = Array.isArray(json.deals) ? json.deals : [];

  return deals
    .map((deal) => ({
      deal_id: deal?.deal_id != null ? String(deal.deal_id) : '',
      title: deal?.title ?? '',
    }))
    .filter((deal): deal is DealTag => Boolean(deal.deal_id) && Boolean(deal.title));
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

type VariantFormValues = {
  price: string;
  stock: string;
  stock_status: string;
  sede: string;
  date: string;
};

const STOCK_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'instock', label: 'En stock' },
  { value: 'outofstock', label: 'Sin stock' },
  { value: 'onbackorder', label: 'En reserva' },
];

function formatDateForInputValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function variantToFormValues(variant: VariantInfo): VariantFormValues {
  return {
    price: variant.price ?? '',
    stock: variant.stock != null ? String(variant.stock) : '',
    stock_status: variant.stock_status ?? 'instock',
    sede: variant.sede ?? '',
    date: formatDateForInputValue(variant.date),
  };
}

function VariantModal({
  active,
  onHide,
  onVariantUpdated,
}: {
  active: ActiveVariant | null;
  onHide: () => void;
  onVariantUpdated: (variant: VariantInfo) => void;
}) {
  const variant = active?.variant;
  const product = active?.product;

  const [formValues, setFormValues] = useState<VariantFormValues>({
    price: '',
    stock: '',
    stock_status: 'instock',
    sede: '',
    date: '',
  });
  const [initialValues, setInitialValues] = useState<VariantFormValues>({
    price: '',
    stock: '',
    stock_status: 'instock',
    sede: '',
    date: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [deals, setDeals] = useState<DealTag[]>([]);
  const [dealsError, setDealsError] = useState<string | null>(null);
  const [isDealsLoading, setIsDealsLoading] = useState(false);

  useEffect(() => {
    if (!variant) {
      setFormValues({ price: '', stock: '', stock_status: 'instock', sede: '', date: '' });
      setInitialValues({ price: '', stock: '', stock_status: 'instock', sede: '', date: '' });
      setSaveError(null);
      setSaveSuccess(null);
      setDeals([]);
      setDealsError(null);
      setIsDealsLoading(false);
      return;
    }

    const nextValues = variantToFormValues(variant);
    setFormValues(nextValues);
    setInitialValues(nextValues);
    setSaveError(null);
    setSaveSuccess(null);
  }, [variant?.id]);

  useEffect(() => {
    let ignore = false;

    if (!variant?.id_woo) {
      setDeals([]);
      setDealsError(null);
      setIsDealsLoading(false);
      return () => {
        ignore = true;
      };
    }

    setIsDealsLoading(true);
    setDealsError(null);

    (async () => {
      try {
        const items = await fetchDealsByVariation(variant.id_woo);
        if (!ignore) {
          setDeals(items);
        }
      } catch (error) {
        if (!ignore) {
          const message =
            error instanceof ApiError ? error.message : 'No se pudieron cargar los deals asociados.';
          setDealsError(message);
        }
      } finally {
        if (!ignore) {
          setIsDealsLoading(false);
        }
      }
    })();

    return () => {
      ignore = true;
    };
  }, [variant?.id_woo]);

  const handleChange = (field: keyof VariantFormValues) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = event.target.value;
      setFormValues((prev) => ({ ...prev, [field]: value }));
      setSaveSuccess(null);
    };

  const isDirty =
    formValues.price !== initialValues.price ||
    formValues.stock !== initialValues.stock ||
    formValues.stock_status !== initialValues.stock_status ||
    formValues.sede !== initialValues.sede ||
    formValues.date !== initialValues.date;

  const handleSave = async (closeAfter: boolean) => {
    if (!variant) return;
    if (isSaving) return;

    const payload: VariantUpdatePayload = {};

    if (formValues.price !== initialValues.price) {
      payload.price = formValues.price.trim() ? formValues.price.trim() : null;
    }
    if (formValues.stock !== initialValues.stock) {
      if (!formValues.stock.trim()) {
        payload.stock = null;
      } else {
        const parsed = Number(formValues.stock);
        payload.stock = Number.isFinite(parsed) ? parsed : null;
      }
    }
    if (formValues.stock_status !== initialValues.stock_status) {
      payload.stock_status = formValues.stock_status;
    }
    if (formValues.sede !== initialValues.sede) {
      payload.sede = formValues.sede.trim() ? formValues.sede.trim() : null;
    }
    if (formValues.date !== initialValues.date) {
      payload.date = formValues.date || null;
    }

    if (!Object.keys(payload).length) {
      if (closeAfter) {
        onHide();
      }
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const updated = await updateProductVariant(variant.id, payload);
      onVariantUpdated(updated);

      const nextValues = variantToFormValues(updated);
      setFormValues(nextValues);
      setInitialValues(nextValues);
      setSaveSuccess(closeAfter ? null : 'Variante actualizada correctamente.');

      if (closeAfter) {
        onHide();
      }
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : 'No se pudo actualizar la variante.';
      setSaveError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAttemptClose = () => {
    if (isSaving) return;
    if (isDirty) {
      void handleSave(true);
    } else {
      onHide();
    }
  };

  return (
    <Modal
      show={!!variant}
      onHide={handleAttemptClose}
      centered
      size="lg"
      backdrop={isSaving ? 'static' : true}
      keyboard={!isSaving}
    >
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

            {saveError && <Alert variant="danger" className="mb-0">{saveError}</Alert>}
            {saveSuccess && <Alert variant="success" className="mb-0">{saveSuccess}</Alert>}

            <Form>
              <Form.Group className="mb-3" controlId="variantPrice">
                <Form.Label>Precio</Form.Label>
                <Form.Control
                  type="number"
                  step="0.01"
                  value={formValues.price}
                  onChange={handleChange('price')}
                  disabled={isSaving}
                  placeholder="Introduce el precio"
                />
                <Form.Text className="text-muted">Se guardará también en WooCommerce.</Form.Text>
              </Form.Group>

              <Form.Group className="mb-3" controlId="variantStock">
                <Form.Label>Stock</Form.Label>
                <Form.Control
                  type="number"
                  step="1"
                  value={formValues.stock}
                  onChange={handleChange('stock')}
                  disabled={isSaving}
                  placeholder="Cantidad disponible"
                />
              </Form.Group>

              <Form.Group className="mb-3" controlId="variantStockStatus">
                <Form.Label>Estado de stock</Form.Label>
                <Form.Select
                  value={formValues.stock_status}
                  onChange={handleChange('stock_status')}
                  disabled={isSaving}
                >
                  {STOCK_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>

              <Form.Group className="mb-3" controlId="variantSede">
                <Form.Label>Sede</Form.Label>
                <Form.Control
                  type="text"
                  value={formValues.sede}
                  onChange={handleChange('sede')}
                  disabled={isSaving}
                  placeholder="Sede de la formación"
                />
              </Form.Group>

              <Form.Group className="mb-3" controlId="variantDate">
                <Form.Label>Fecha</Form.Label>
                <Form.Control
                  type="date"
                  value={formValues.date}
                  onChange={handleChange('date')}
                  disabled={isSaving}
                />
              </Form.Group>
            </Form>

            <div>
              <p className="text-uppercase text-muted small fw-semibold mb-2">Deals asociados</p>
              {dealsError ? (
                <Alert variant="danger" className="mb-0">
                  {dealsError}
                </Alert>
              ) : isDealsLoading ? (
                <div className="d-flex align-items-center gap-2 text-muted">
                  <Spinner animation="border" size="sm" />
                  <span>Cargando deals…</span>
                </div>
              ) : deals.length ? (
                <Stack direction="horizontal" gap={2} className="flex-wrap">
                  {deals.map((deal) => (
                    <Badge bg="secondary" key={deal.deal_id} className="mb-1">
                      {deal.title}
                    </Badge>
                  ))}
                </Stack>
              ) : (
                <div className="text-muted small">No hay deals asociados a esta variación.</div>
              )}
            </div>

            <dl className="row mb-0">
              <dt className="col-sm-4 text-muted">Creada</dt>
              <dd className="col-sm-8">{formatDate(variant.created_at) ?? '—'}</dd>

              <dt className="col-sm-4 text-muted">Actualizada</dt>
              <dd className="col-sm-8">{formatDate(variant.updated_at) ?? '—'}</dd>
            </dl>
          </Stack>
        ) : null}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleAttemptClose} disabled={isSaving}>
          Cerrar
        </Button>
        <Button
          variant="primary"
          onClick={() => handleSave(false)}
          disabled={isSaving || !isDirty}
        >
          {isSaving ? <Spinner as="span" animation="border" size="sm" role="status" className="me-2" /> : null}
          {isSaving ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </Modal.Footer>
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

  const handleVariantUpdated = (updatedVariant: VariantInfo) => {
    setProducts((prev) =>
      prev.map((product) => {
        const hasVariant = product.variants.some((item) => item.id === updatedVariant.id);
        if (!hasVariant) {
          return product;
        }

        return {
          ...product,
          variants: product.variants.map((item) =>
            item.id === updatedVariant.id ? { ...item, ...updatedVariant } : item,
          ),
        };
      }),
    );

    setActiveVariant((prev) => {
      if (!prev || prev.variant.id !== updatedVariant.id) {
        return prev;
      }

      return {
        product: {
          ...prev.product,
          variants: prev.product.variants.map((item) =>
            item.id === updatedVariant.id ? { ...item, ...updatedVariant } : item,
          ),
        },
        variant: { ...prev.variant, ...updatedVariant },
      };
    });
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

      <VariantModal
        active={activeVariant}
        onHide={handleCloseModal}
        onVariantUpdated={handleVariantUpdated}
      />
    </>
  );
}
