import { ChangeEvent, useEffect, useRef, useState } from 'react';
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

type ProductDefaults = {
  default_variant_start: string | null;
  default_variant_end: string | null;
  default_variant_stock_status: string | null;
  default_variant_stock_quantity: number | null;
  default_variant_price: string | null;
};

type ProductInfo = ProductDefaults & {
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

type ProductDefaultsUpdateResponse = {
  ok?: boolean;
  product?: ProductDefaults | null;
  message?: string;
};

type ProductDefaultsUpdatePayload = {
  stock_status?: string | null;
  stock_quantity?: number | null;
  price?: string | null;
};

type VariantBulkCreateResponse = {
  ok?: boolean;
  created?: VariantInfo[];
  skipped?: number;
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
  status?: string | null;
  sede?: string | null;
  date?: string | null;
};

type DealProductInfo = {
  id: string;
  name: string | null;
  code: string | null;
  price: string | null;
};

type DealsByVariationResponse = {
  ok?: boolean;
  deals?: Array<{
    deal_id?: string | null;
    title?: string | null;
    products?: unknown;
  }>;
  message?: string;
};

type DealTag = {
  deal_id: string;
  title: string;
  products: DealProductInfo[];
};

const dateFormatter = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const STOCK_STATUS_SUMMARY_LABELS: Record<string, string> = {
  instock: 'En stock',
  outofstock: 'Sin stock',
  onbackorder: 'Reservar por adelantado',
};

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return dateFormatter.format(date);
}

function buildProductDefaultsSummary(product: ProductInfo): string | null {
  const parts: string[] = [];

  if (product.default_variant_price) {
    parts.push(`Precio: ${product.default_variant_price}`);
  }

  if (product.default_variant_stock_quantity != null) {
    parts.push(`Stock: ${product.default_variant_stock_quantity}`);
  }

  if (product.default_variant_stock_status) {
    const statusLabel =
      STOCK_STATUS_SUMMARY_LABELS[product.default_variant_stock_status.trim().toLowerCase()] ??
      product.default_variant_stock_status;
    parts.push(`Estado: ${statusLabel}`);
  }

  if (!parts.length) {
    return null;
  }

  return parts.join(' · ');
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

  return products.map((product) => {
    const defaultStockQuantity =
      typeof (product as any).default_variant_stock_quantity === 'number'
        ? (product as any).default_variant_stock_quantity
        : (product as any).default_variant_stock_quantity != null &&
            !Number.isNaN(Number((product as any).default_variant_stock_quantity))
          ? Number((product as any).default_variant_stock_quantity)
          : null;

    return {
      id: product.id,
      id_woo: product.id_woo != null ? String(product.id_woo) : null,
      name: product.name ?? null,
      code: product.code ?? null,
      category: product.category ?? null,
      default_variant_start: product.default_variant_start ?? null,
      default_variant_end: product.default_variant_end ?? null,
      default_variant_stock_status: product.default_variant_stock_status ?? null,
      default_variant_stock_quantity: defaultStockQuantity,
      default_variant_price: product.default_variant_price != null ? String(product.default_variant_price) : null,
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
    };
  });
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

async function updateProductVariantDefaults(
  productId: string,
  updates: ProductDefaultsUpdatePayload,
): Promise<ProductDefaults> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/product-variant-settings`, {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ product_id: productId, ...updates }),
    });
  } catch (error) {
    throw new ApiError('NETWORK_ERROR', 'No se pudo conectar con el servidor.', undefined);
  }

  const text = await response.text();
  let json: ProductDefaultsUpdateResponse = {};

  if (text) {
    try {
      json = JSON.parse(text) as ProductDefaultsUpdateResponse;
    } catch (error) {
      console.error('[updateProductVariantDefaults] invalid JSON response', error);
      json = {};
    }
  }

  if (!response.ok || json.ok === false || !json.product) {
    const message = json.message || 'No se pudo actualizar la configuración del producto.';
    throw new ApiError('UPDATE_DEFAULTS_ERROR', message, response.status || undefined);
  }

  const stockQuantity =
    typeof json.product.default_variant_stock_quantity === 'number'
      ? json.product.default_variant_stock_quantity
      : json.product.default_variant_stock_quantity != null &&
          !Number.isNaN(Number(json.product.default_variant_stock_quantity))
        ? Number(json.product.default_variant_stock_quantity)
        : null;

  return {
    default_variant_start: json.product.default_variant_start ?? null,
    default_variant_end: json.product.default_variant_end ?? null,
    default_variant_stock_status: json.product.default_variant_stock_status ?? null,
    default_variant_stock_quantity: stockQuantity,
    default_variant_price:
      json.product.default_variant_price != null ? String(json.product.default_variant_price) : null,
  };
}

async function createProductVariantsForProduct(
  productId: string,
  sedes: string[],
  dates: string[],
): Promise<{ created: VariantInfo[]; skipped: number; message: string | null }> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/product-variants-create`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ product_id: productId, sedes, dates }),
    });
  } catch (error) {
    throw new ApiError('NETWORK_ERROR', 'No se pudo conectar con el servidor.', undefined);
  }

  const text = await response.text();
  let json: VariantBulkCreateResponse = {};

  if (text) {
    try {
      json = JSON.parse(text) as VariantBulkCreateResponse;
    } catch (error) {
      console.error('[createProductVariantsForProduct] invalid JSON response', error);
      json = {};
    }
  }

  if (!response.ok || json.ok === false) {
    const message = json.message || 'No se pudieron crear las variantes.';
    throw new ApiError('CREATE_VARIANTS_ERROR', message, response.status || undefined);
  }

  const createdRaw = Array.isArray(json.created) ? json.created : [];
  const created = createdRaw.map((item, index) =>
    normalizeVariantFromResponse(item, `${productId}-new-${index}`),
  );

  return {
    created,
    skipped: typeof json.skipped === 'number' ? json.skipped : 0,
    message: typeof json.message === 'string' ? json.message : null,
  };
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

function normalizeDealProductPrice(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toString() : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  if (typeof value === 'object') {
    const record = value as { toNumber?: () => number; valueOf?: () => unknown; toString?: () => string };

    if (typeof record.toNumber === 'function') {
      try {
        const numeric = record.toNumber();
        if (Number.isFinite(numeric)) {
          return numeric.toString();
        }
      } catch (error) {
        console.warn('[normalizeDealProductPrice] could not convert decimal to number', error);
      }
    }

    if (typeof record.valueOf === 'function') {
      const primitive = record.valueOf();
      if (typeof primitive === 'number' && Number.isFinite(primitive)) {
        return primitive.toString();
      }
      if (typeof primitive === 'string') {
        const text = primitive.trim();
        if (text.length) {
          return text;
        }
      }
    }

    if (typeof record.toString === 'function') {
      const text = record.toString();
      if (text && text !== '[object Object]') {
        return text;
      }
    }
  }

  return null;
}

function normalizeDealProducts(raw: unknown): DealProductInfo[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const products: DealProductInfo[] = [];

  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }

    const item = entry as Record<string, any>;
    const price = normalizeDealProductPrice(item.price);
    const name = typeof item.name === 'string' ? item.name : null;
    const code = typeof item.code === 'string' ? item.code : null;
    const id =
      item.id != null && item.id !== ''
        ? String(item.id)
        : item.deal_product_id != null && item.deal_product_id !== ''
          ? String(item.deal_product_id)
          : `deal-product-${index}`;

    products.push({
      id,
      name,
      code,
      price,
    });
  });

  return products;
}

function findDealProductPriceForProduct(deals: DealTag[], product: ProductInfo): string | null {
  const normalizedName = product.name?.trim().toLowerCase() ?? null;
  const normalizedCode = product.code?.trim().toLowerCase() ?? null;

  for (const deal of deals) {
    let fallbackPrice: string | null = null;

    for (const dealProduct of deal.products) {
      if (!dealProduct.price) {
        continue;
      }

      const productName = dealProduct.name?.trim().toLowerCase() ?? null;
      const productCode = dealProduct.code?.trim().toLowerCase() ?? null;

      if ((normalizedCode && productCode === normalizedCode) || (normalizedName && productName === normalizedName)) {
        return dealProduct.price;
      }

      if (!fallbackPrice) {
        fallbackPrice = dealProduct.price;
      }
    }

    if (fallbackPrice) {
      return fallbackPrice;
    }
  }

  return null;
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
      products: normalizeDealProducts((deal as any)?.products ?? (deal as any)?.deal_products ?? []),
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
  status: string;
  sede: string;
  date: string;
};

const STOCK_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'instock', label: 'En stock' },
  { value: 'outofstock', label: 'Sin stock' },
  { value: 'onbackorder', label: 'En reserva' },
];

const PUBLICATION_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'publish', label: 'Publicado' },
  { value: 'private', label: 'Privado' },
];

function getStatusBadgeVariant(status: string | null): string {
  const normalized = status?.toLowerCase();
  if (normalized === 'publish') {
    return 'success';
  }
  if (normalized === 'private') {
    return 'danger';
  }
  return 'secondary';
}

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
    status: variant.status ?? 'publish',
    sede: variant.sede ?? '',
    date: formatDateForInputValue(variant.date),
  };
}

type ProductDefaultsFormValues = {
  stock_status: string;
  stock_quantity: string;
  price: string;
};

function ProductDefaultsModal({
  product,
  onHide,
  onSaved,
}: {
  product: ProductInfo | null;
  onHide: () => void;
  onSaved: (productId: string, defaults: ProductDefaults) => void;
}) {
  const [formValues, setFormValues] = useState<ProductDefaultsFormValues>({
    stock_status: '',
    stock_quantity: '',
    price: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [didUserEditPrice, setDidUserEditPrice] = useState(false);
  const didUserEditPriceRef = useRef(didUserEditPrice);

  useEffect(() => {
    didUserEditPriceRef.current = didUserEditPrice;
  }, [didUserEditPrice]);

  useEffect(() => {
    if (!product) {
      setFormValues({ stock_status: '', stock_quantity: '', price: '' });
      setError(null);
      setSuccess(null);
      setIsSaving(false);
      setDidUserEditPrice(false);
      return;
    }

    setFormValues({
      stock_status: product.default_variant_stock_status ?? '',
      stock_quantity:
        product.default_variant_stock_quantity != null
          ? String(product.default_variant_stock_quantity)
          : '',
      price: product.default_variant_price ?? '',
    });
    setError(null);
    setSuccess(null);
    setIsSaving(false);
    setDidUserEditPrice(false);
  }, [product]);

  useEffect(() => {
    if (!product) {
      return;
    }

    if (didUserEditPriceRef.current) {
      return;
    }

    if (formValues.price && formValues.price.trim().length) {
      return;
    }

    if (product.default_variant_price && product.default_variant_price.trim().length) {
      return;
    }

    const variantWithWooId = product.variants.find((variant) => variant.id_woo);
    const wooId = variantWithWooId?.id_woo;

    if (!wooId) {
      return;
    }

    let ignore = false;

    (async () => {
      try {
        const deals = await fetchDealsByVariation(wooId);
        if (ignore) {
          return;
        }

        if (didUserEditPriceRef.current) {
          return;
        }

        const priceFromDeals = findDealProductPriceForProduct(deals, product);

        if (priceFromDeals) {
          setFormValues((prev) => {
            if (prev.price && prev.price.trim().length) {
              return prev;
            }
            return { ...prev, price: priceFromDeals };
          });
        }
      } catch (error) {
        console.warn('[ProductDefaultsModal] could not prefill price from deals', error);
      }
    })();

    return () => {
      ignore = true;
    };
  }, [product, formValues.price]);

  const handleChange = (field: keyof ProductDefaultsFormValues) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setFormValues((prev) => ({ ...prev, [field]: value }));
      setSuccess(null);
      if (field === 'price') {
        setDidUserEditPrice(true);
      }
    };

  const handleSave = async () => {
    if (!product) return;
    if (isSaving) return;

    let stockQuantityValue: number | null = null;
    const stockQuantityText = formValues.stock_quantity.trim();
    if (stockQuantityText) {
      const parsed = Number(stockQuantityText);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError('La cantidad de stock debe ser un número positivo.');
        return;
      }
      stockQuantityValue = Math.floor(parsed);
    }

    const payload: ProductDefaultsUpdatePayload = {
      stock_status: formValues.stock_status || null,
      stock_quantity: stockQuantityValue,
      price: formValues.price.trim() ? formValues.price.trim() : null,
    };

    setIsSaving(true);
    setError(null);

    try {
      const defaults = await updateProductVariantDefaults(product.id, payload);
      onSaved(product.id, defaults);
      setFormValues({
        stock_status: defaults.default_variant_stock_status ?? '',
        stock_quantity:
          defaults.default_variant_stock_quantity != null
            ? String(defaults.default_variant_stock_quantity)
            : '',
        price: defaults.default_variant_price ?? '',
      });
      setDidUserEditPrice(false);
      setSuccess('Configuración guardada correctamente.');
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : 'No se pudo guardar la configuración del producto.';
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAttemptClose = () => {
    if (isSaving) return;
    onHide();
  };

  return (
    <Modal show={!!product} onHide={handleAttemptClose} centered backdrop={isSaving ? 'static' : true}>
      <Modal.Header closeButton={!isSaving} closeLabel="Cerrar">
        <Modal.Title>Configurar producto</Modal.Title>
      </Modal.Header>
      <Modal.Body className="d-flex flex-column gap-3">
        {error && (
          <Alert variant="danger" className="mb-0">
            {error}
          </Alert>
        )}
        {success && (
          <Alert variant="success" className="mb-0">
            {success}
          </Alert>
        )}
        <Form.Group controlId="product-default-price">
          <Form.Label>Precio por defecto</Form.Label>
          <Form.Control
            type="number"
            step="0.01"
            min="0"
            value={formValues.price}
            onChange={handleChange('price')}
            placeholder="Ej. 120"
            disabled={isSaving}
          />
        </Form.Group>
        <Form.Group controlId="product-default-stock-quantity">
          <Form.Label>Cantidad de stock por defecto</Form.Label>
          <Form.Control
            type="number"
            min="0"
            step="1"
            value={formValues.stock_quantity}
            onChange={handleChange('stock_quantity')}
            placeholder="Ej. 10"
            disabled={isSaving}
          />
          <Form.Text className="text-muted">Déjalo vacío para no gestionar stock.</Form.Text>
        </Form.Group>
        <Form.Group controlId="product-default-stock-status">
          <Form.Label>Estado de stock por defecto</Form.Label>
          <Form.Select
            value={formValues.stock_status}
            onChange={handleChange('stock_status')}
            disabled={isSaving}
          >
            <option value="">— Sin valor —</option>
            <option value="instock">En stock</option>
            <option value="outofstock">Sin stock</option>
            <option value="onbackorder">Reservar por adelantado</option>
          </Form.Select>
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleAttemptClose} disabled={isSaving}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <>
              <Spinner
                as="span"
                animation="border"
                size="sm"
                role="status"
                aria-hidden="true"
                className="me-2"
              />
              Guardando…
            </>
          ) : (
            'Guardar'
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

function VariantCreationModal({
  product,
  onHide,
  onVariantsCreated,
}: {
  product: ProductInfo | null;
  onHide: () => void;
  onVariantsCreated: (
    productId: string,
    result: { created: VariantInfo[]; skipped: number; message: string | null },
  ) => void;
}) {
  const [sedesInput, setSedesInput] = useState('');
  const [datesInput, setDatesInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!product) {
      setSedesInput('');
      setDatesInput('');
      setError(null);
      setSuccess(null);
      setIsSaving(false);
      return;
    }

    setSedesInput('');
    setDatesInput('');
    setError(null);
    setSuccess(null);
    setIsSaving(false);
  }, [product]);

  const parseSedesInput = (value: string): string[] => {
    return value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .filter((item, index, array) => array.findIndex((current) => current.toLowerCase() === item.toLowerCase()) === index);
  };

  const parseDatesInput = (value: string): { values: string[]; invalid: string | null } => {
    const raw = value.split(',');
    const seen = new Set<string>();
    const values: string[] = [];

    for (const chunk of raw) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!match) {
        return { values: [], invalid: trimmed };
      }
      const day = match[1].padStart(2, '0');
      const month = match[2].padStart(2, '0');
      const year = match[3];
      const normalized = `${day}/${month}/${year}`;
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      values.push(normalized);
    }

    return { values, invalid: null };
  };

  const handleSave = async () => {
    if (!product) return;
    if (isSaving) return;

    const sedes = parseSedesInput(sedesInput);
    const { values: dates, invalid } = parseDatesInput(datesInput);

    if (!sedes.length) {
      setError('Debes indicar al menos una sede.');
      return;
    }

    if (invalid) {
      setError(`Formato de fecha inválido: ${invalid}`);
      return;
    }

    if (!dates.length) {
      setError('Debes indicar al menos una fecha.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const result = await createProductVariantsForProduct(product.id, sedes, dates);
      onVariantsCreated(product.id, result);

      const createdMessage = `Se crearon ${result.created.length} variantes.`;
      const skippedMessage = result.skipped
        ? ` ${result.skipped} combinaciones ya existían.`
        : '';

      setSuccess(result.message ?? `${createdMessage}${skippedMessage}`);

      if (result.created.length) {
        setSedesInput('');
        setDatesInput('');
      }
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : 'No se pudieron crear las variantes.';
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAttemptClose = () => {
    if (isSaving) return;
    onHide();
  };

  const sedesPreview = parseSedesInput(sedesInput);
  const { values: datesPreview, invalid: invalidDatePreview } = parseDatesInput(datesInput);
  const combinationsPreview = invalidDatePreview ? 0 : sedesPreview.length * datesPreview.length;

  return (
    <Modal show={!!product} onHide={handleAttemptClose} centered backdrop={isSaving ? 'static' : true}>
      <Modal.Header closeButton={!isSaving} closeLabel="Cerrar">
        <Modal.Title>Añadir variantes</Modal.Title>
      </Modal.Header>
      <Modal.Body className="d-flex flex-column gap-3">
        {error && (
          <Alert variant="danger" className="mb-0">
            {error}
          </Alert>
        )}
        {success && (
          <Alert variant="success" className="mb-0">
            {success}
          </Alert>
        )}
        <Form.Group controlId="variant-create-sedes">
          <Form.Label>Sedes</Form.Label>
          <Form.Control
            as="textarea"
            rows={3}
            value={sedesInput}
            onChange={(event) => {
              setSedesInput(event.target.value);
              setSuccess(null);
            }}
            placeholder="Introduce una sede por línea o separadas por comas"
            disabled={isSaving}
          />
          <Form.Text className="text-muted">
            Se ignorarán las sedes duplicadas automáticamente.
          </Form.Text>
        </Form.Group>
        <Form.Group controlId="variant-create-dates">
          <Form.Label>Fechas</Form.Label>
          <Form.Control
            value={datesInput}
            onChange={(event) => {
              setDatesInput(event.target.value);
              setSuccess(null);
            }}
            placeholder="dd/mm/aaaa, dd/mm/aaaa"
            disabled={isSaving}
          />
          <Form.Text className="text-muted">
            Usa el formato dd/mm/aaaa y separa las fechas con comas.
          </Form.Text>
        </Form.Group>
        {invalidDatePreview ? (
          <div className="text-danger small">Formato de fecha inválido detectado: {invalidDatePreview}</div>
        ) : null}
        {combinationsPreview > 0 ? (
          <div className="text-muted small">
            Se crearán hasta {combinationsPreview} variantes nuevas (combinaciones de sede y fecha).
          </div>
        ) : null}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleAttemptClose} disabled={isSaving}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <>
              <Spinner
                as="span"
                animation="border"
                size="sm"
                role="status"
                aria-hidden="true"
                className="me-2"
              />
              Creando…
            </>
          ) : (
            'Crear variantes'
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
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
    status: 'publish',
    sede: '',
    date: '',
  });
  const [initialValues, setInitialValues] = useState<VariantFormValues>({
    price: '',
    stock: '',
    stock_status: 'instock',
    status: 'publish',
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
      setFormValues({
        price: '',
        stock: '',
        stock_status: 'instock',
        status: 'publish',
        sede: '',
        date: '',
      });
      setInitialValues({
        price: '',
        stock: '',
        stock_status: 'instock',
        status: 'publish',
        sede: '',
        date: '',
      });
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
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setFormValues((prev) => ({ ...prev, [field]: value }));
      setSaveSuccess(null);
    };

  const isDirty =
    formValues.price !== initialValues.price ||
    formValues.stock !== initialValues.stock ||
    formValues.stock_status !== initialValues.stock_status ||
    formValues.status !== initialValues.status ||
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
      payload.stock_status = formValues.stock_status.trim()
        ? formValues.stock_status.trim()
        : 'instock';
    }
    if (formValues.status !== initialValues.status) {
      payload.status = formValues.status.trim() ? formValues.status.trim() : null;
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
                {variant.status && (
                  <Badge bg={getStatusBadgeVariant(variant.status)}>{variant.status}</Badge>
                )}
              </Stack>
              <div className="text-muted small">ID Woo: {variant.id_woo}</div>
            </div>

            {saveError && <Alert variant="danger" className="mb-0">{saveError}</Alert>}
            {saveSuccess && <Alert variant="success" className="mb-0">{saveSuccess}</Alert>}

            <Form>
              <Form.Group className="mb-3" controlId="variantStatus">
                <Form.Label>Estado de publicación</Form.Label>
                <Form.Select
                  value={formValues.status}
                  onChange={handleChange('status')}
                  disabled={isSaving}
                >
                  {!PUBLICATION_STATUS_OPTIONS.some((option) => option.value === formValues.status) &&
                    formValues.status && (
                      <option value={formValues.status}>{formValues.status}</option>
                    )}
                  {PUBLICATION_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>

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
  const [feedback, setFeedback] = useState<
    { tone: 'success' | 'danger' | 'info'; text: string } | null
  >(null);
  const [activeProductConfig, setActiveProductConfig] = useState<ProductInfo | null>(null);
  const [activeVariantCreator, setActiveVariantCreator] = useState<ProductInfo | null>(null);

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

  const handleOpenProductConfig = (product: ProductInfo) => {
    setActiveProductConfig(product);
  };

  const handleProductDefaultsSaved = (productId: string, defaults: ProductDefaults) => {
    setProducts((prev) =>
      prev.map((product) => (product.id === productId ? { ...product, ...defaults } : product)),
    );

    setActiveProductConfig((prev) =>
      prev && prev.id === productId ? { ...prev, ...defaults } : prev,
    );

    setFeedback({
      tone: 'success',
      text: 'Configuración del producto guardada correctamente.',
    });
  };

  const handleCloseProductConfig = () => {
    setActiveProductConfig(null);
  };

  const handleOpenVariantCreator = (product: ProductInfo) => {
    setActiveVariantCreator(product);
  };

  const handleCloseVariantCreator = () => {
    setActiveVariantCreator(null);
  };

  const handleVariantsCreated = (
    productId: string,
    result: { created: VariantInfo[]; skipped: number; message: string | null },
  ) => {
    if (result.created.length) {
      setProducts((prev) =>
        prev.map((product) =>
          product.id === productId
            ? { ...product, variants: [...product.variants, ...result.created].sort(compareVariants) }
            : product,
        ),
      );
    }

    setActiveVariantCreator((prev) =>
      prev && prev.id === productId
        ? { ...prev, variants: [...prev.variants, ...result.created].sort(compareVariants) }
        : prev,
    );

    if (result.created.length) {
      setFeedback({
        tone: 'success',
        text:
          result.message ??
          `Se añadieron ${result.created.length} variantes nuevas.${
            result.skipped ? ` ${result.skipped} combinaciones ya existían.` : ''
          }`,
      });
    } else if (result.skipped) {
      setFeedback({
        tone: 'info',
        text: result.message ?? 'Las combinaciones indicadas ya existen.',
      });
    }
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
                {products.map((product) => {
                  const defaultsSummary = buildProductDefaultsSummary(product);

                  return (
                    <Accordion.Item eventKey={product.id} key={product.id}>
                      <Accordion.Header>
                        <div className="d-flex flex-column">
                          <span className="fw-semibold">{product.name ?? 'Producto sin nombre'}</span>
                          <small className="text-muted">ID Woo: {product.id_woo ?? '—'}</small>
                        </div>
                      </Accordion.Header>
                      <Accordion.Body>
                        <Stack direction="horizontal" gap={2} className="flex-wrap mb-3">
                          <Button
                            size="sm"
                            variant="outline-primary"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              handleOpenProductConfig(product);
                            }}
                          >
                            Configurar producto
                          </Button>
                          <Button
                            size="sm"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              handleOpenVariantCreator(product);
                            }}
                          >
                            Añadir variantes
                          </Button>
                        </Stack>

                        {defaultsSummary ? (
                          <div className="text-muted small mb-3">
                            Configuración por defecto: {defaultsSummary}
                          </div>
                        ) : null}

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
                                    {variant.status && (
                                      <Badge bg={getStatusBadgeVariant(variant.status)}>
                                        {variant.status}
                                      </Badge>
                                    )}
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
                  );
                })}
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
      <ProductDefaultsModal
        product={activeProductConfig}
        onHide={handleCloseProductConfig}
        onSaved={handleProductDefaultsSaved}
      />
      <VariantCreationModal
        product={activeVariantCreator}
        onHide={handleCloseVariantCreator}
        onVariantsCreated={handleVariantsCreated}
      />
    </>
  );
}
