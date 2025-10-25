import { ChangeEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  ListGroup,
  Modal,
  Row,
  Spinner,
  Stack,
  Table,
} from 'react-bootstrap';

import { ApiError } from "../../api/client";
import type { SessionStudent } from "../../api/sessions.types";
import {
  fetchActiveTrainers,
  fetchMobileUnitsCatalog,
  fetchRoomsCatalog,
} from "../presupuestos/api/catalogs.api";
import { fetchSessionAvailability } from "../presupuestos/api/sessions.api";
import { fetchDealStudents } from "../presupuestos/api/students.api";
import { BudgetDetailModalAbierta } from '../presupuestos/abierta/BudgetDetailModalAbierta';
import type { DealSummary } from '../../types/deal';
import { emitToast } from '../../utils/toast';
import {
  createProductVariantsForProduct,
  deleteProductVariant,
  fetchDealsByVariation,
  fetchProductsWithVariants,
  updateProductVariant,
  updateProductVariantDefaults,
} from './api';
import type {
  ActiveVariant,
  DealTag,
  ProductDefaults,
  ProductDefaultsUpdatePayload,
  ProductInfo,
  VariantInfo,
  VariantLocationGroup,
  VariantMonthGroup,
  VariantUpdatePayload,
} from './types';
import { buildVariantGroups, compareVariants, findDealProductPriceForProduct } from './utils';

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

  if (product.hora_inicio || product.hora_fin) {
    const inicio = product.hora_inicio ?? '—';
    const fin = product.hora_fin ?? '—';
    parts.push(`Horario: ${inicio} - ${fin}`);
  }

  if (!parts.length) {
    return null;
  }

  return parts.join(' · ');
}

type VariantFormValues = {
  price: string;
  stock: string;
  stock_status: string;
  status: string;
  sede: string;
  date: string;
  trainer_id: string;
  sala_id: string;
  unidad_movil_id: string;
};

const STOCK_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'instock', label: 'En stock' },
  { value: 'outofstock', label: 'Sin stock' },
  { value: 'onbackorder', label: 'En reserva' },
];

const PUBLICATION_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'publish', label: 'Publicado' },
  { value: 'private', label: 'Cancelado' },
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
    trainer_id: variant.trainer_id ?? '',
    sala_id: variant.sala_id ?? '',
    unidad_movil_id: variant.unidad_movil_id ?? '',
  };
}

type ProductDefaultsFormValues = {
  stock_status: string;
  stock_quantity: string;
  price: string;
  hora_inicio: string;
  hora_fin: string;
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
    hora_inicio: '',
    hora_fin: '',
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
      setFormValues({ stock_status: '', stock_quantity: '', price: '', hora_inicio: '', hora_fin: '' });
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
      hora_inicio: product.hora_inicio ?? '',
      hora_fin: product.hora_fin ?? '',
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
      hora_inicio: formValues.hora_inicio.trim() ? formValues.hora_inicio.trim() : null,
      hora_fin: formValues.hora_fin.trim() ? formValues.hora_fin.trim() : null,
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
        hora_inicio: defaults.hora_inicio ?? '',
        hora_fin: defaults.hora_fin ?? '',
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
        <Form.Group controlId="product-default-start-time">
          <Form.Label>Hora de inicio</Form.Label>
          <Form.Control
            type="time"
            value={formValues.hora_inicio}
            onChange={handleChange('hora_inicio')}
            disabled={isSaving}
          />
        </Form.Group>
        <Form.Group controlId="product-default-end-time">
          <Form.Label>Hora de fin</Form.Label>
          <Form.Control
            type="time"
            value={formValues.hora_fin}
            onChange={handleChange('hora_fin')}
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

export function VariantModal({
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
    trainer_id: '',
    sala_id: '',
    unidad_movil_id: '',
  });
  const [initialValues, setInitialValues] = useState<VariantFormValues>({
    price: '',
    stock: '',
    stock_status: 'instock',
    status: 'publish',
    sede: '',
    date: '',
    trainer_id: '',
    sala_id: '',
    unidad_movil_id: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [deals, setDeals] = useState<DealTag[]>([]);
  const [dealsError, setDealsError] = useState<string | null>(null);
  const [isDealsLoading, setIsDealsLoading] = useState(false);
  const [dealStudents, setDealStudents] = useState<Record<string, SessionStudent[]>>({});
  const [dealStudentsError, setDealStudentsError] = useState<string | null>(null);
  const [isDealStudentsLoading, setIsDealStudentsLoading] = useState(false);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [selectedDealSummary, setSelectedDealSummary] = useState<DealSummary | null>(null);
  const totalDealStudents = useMemo(
    () => {
      if (!deals.length) {
        return 0;
      }

      const hasStudentsData = Object.keys(dealStudents).length > 0;

      return deals.reduce((sum, deal) => {
        const dealId = typeof deal.deal_id === 'string' ? deal.deal_id.trim() : '';
        if (hasStudentsData && dealId) {
          const students = dealStudents[dealId];
          if (Array.isArray(students)) {
            return sum + students.length;
          }
        }
        return sum + deal.students_count;
      }, 0);
    },
    [deals, dealStudents],
  );
  const isSummaryLoading = isDealsLoading || isDealStudentsLoading;
  const summaryError = dealsError ?? dealStudentsError;
  const totalDealStudentsDisplay = isSummaryLoading
    ? 'Cargando…'
    : summaryError
    ? 'No disponible'
    : String(totalDealStudents);

  const productHeaderLabel = (() => {
    const rawName = product?.name ?? '';
    const trimmedName = rawName.trim();
    if (trimmedName.length) {
      return trimmedName;
    }

    const rawCode = product?.code ?? '';
    const trimmedCode = rawCode.trim();
    if (trimmedCode.length) {
      return trimmedCode;
    }

    return 'Producto sin nombre';
  })();

  const variantSummaryParts: string[] = [];
  const variantSede = variant?.sede ? variant.sede.trim() : '';
  if (variantSede.length) {
    variantSummaryParts.push(variantSede);
  }

  const formattedVariantDate = variant?.date ? formatDate(variant.date) : null;
  if (formattedVariantDate) {
    variantSummaryParts.push(formattedVariantDate);
  }

  const variantSummary = variantSummaryParts.join(' · ');
  const variantIdWoo = variant?.id_woo ? String(variant.id_woo).trim() : '';
  const variantSedeNormalized = (variant?.sede ?? '').trim().toLowerCase();

  const trainerDisplay = useMemo(() => {
    if (!variant) return '—';
    if (variant.trainer) {
      const parts = [variant.trainer.name ?? '', variant.trainer.apellido ?? '']
        .map((part) => part.trim())
        .filter((part) => part.length);
      if (parts.length) {
        return parts.join(' ');
      }
    }
    return variant.trainer_id ?? '—';
  }, [variant]);

  const roomDisplay = useMemo(() => {
    if (!variant) return '—';
    if (variant.sala) {
      const base = (variant.sala.name ?? '').trim();
      const sede = variant.sala.sede ? ` (${variant.sala.sede})` : '';
      const label = `${base}${sede}`.trim();
      if (label.length) return label;
    }
    return variant.sala_id ?? '—';
  }, [variant]);

  const unitDisplay = useMemo(() => {
    if (!variant) return '—';
    if (variant.unidad) {
      const base = (variant.unidad.name ?? '').trim();
      const matricula = variant.unidad.matricula ? ` (${variant.unidad.matricula})` : '';
      const label = `${base}${matricula}`.trim();
      if (label.length) return label;
    }
    return variant.unidad_movil_id ?? '—';
  }, [variant]);

  const trainersQuery = useQuery({
    queryKey: ['trainers', 'active'],
    queryFn: fetchActiveTrainers,
    enabled: !!variant,
    staleTime: 5 * 60 * 1000,
  });
  const roomsQuery = useQuery({
    queryKey: ['rooms', 'catalog'],
    queryFn: fetchRoomsCatalog,
    enabled: !!variant,
    staleTime: 5 * 60 * 1000,
  });
  const unitsQuery = useQuery({
    queryKey: ['mobile-units', 'catalog'],
    queryFn: fetchMobileUnitsCatalog,
    enabled: !!variant,
    staleTime: 5 * 60 * 1000,
  });

  const trainers = trainersQuery.data ?? [];
  const allRooms = roomsQuery.data ?? [];
  const units = unitsQuery.data ?? [];

  const rooms = useMemo(() => {
    const base =
      variantSedeNormalized === 'sabadell'
        ? allRooms.filter((room) => (room.sede ?? '').trim().toLowerCase() === 'gep sabadell')
        : allRooms;

    if (formValues.sala_id && !base.some((room) => room.sala_id === formValues.sala_id)) {
      const selectedRoom = allRooms.find((room) => room.sala_id === formValues.sala_id);
      return selectedRoom ? [...base, selectedRoom] : base;
    }

    return base;
  }, [allRooms, formValues.sala_id, variantSedeNormalized]);

  const variantRange = useMemo(() => {
    if (!variant?.date) return null;
    const parsedDate = new Date(variant.date);
    if (Number.isNaN(parsedDate.getTime())) {
      return null;
    }

    const parseTime = (value: string | null | undefined) => {
      if (!value) return null;
      const match = String(value).trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!match) return null;
      const hour = Number.parseInt(match[1], 10);
      const minute = Number.parseInt(match[2], 10);
      if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
      return { hour, minute };
    };

    const startParts = parseTime(product?.hora_inicio ?? null);
    const endParts = parseTime(product?.hora_fin ?? null);
    const effectiveStart = startParts ?? { hour: 9, minute: 0 };
    const effectiveEnd = endParts ?? (startParts ?? { hour: 11, minute: 0 });

    const year = parsedDate.getFullYear();
    const month = parsedDate.getMonth();
    const day = parsedDate.getDate();
    const build = (parts: { hour: number; minute: number }) =>
      new Date(Date.UTC(year, month, day, parts.hour, parts.minute, 0, 0));

    const start = build(effectiveStart);
    let end = build(effectiveEnd);
    if (end.getTime() <= start.getTime()) {
      end = new Date(start.getTime() + 60 * 60 * 1000);
    }

    return { start: start.toISOString(), end: end.toISOString() };
  }, [product?.hora_fin, product?.hora_inicio, variant?.date]);

  const availabilityQuery = useQuery({
    queryKey: ['variantAvailability', variant?.id ?? null, variantRange?.start ?? null, variantRange?.end ?? null],
    queryFn: () =>
      fetchSessionAvailability({
        start: variantRange!.start,
        end: variantRange!.end,
        excludeVariantId: variant?.id,
      }),
    enabled: !!variant && !!variantRange,
    staleTime: 60 * 1000,
  });

  const availability = availabilityQuery.data;
  const blockedTrainerIds = useMemo(
    () => new Set(availability?.trainers ?? []),
    [availability?.trainers],
  );
  const blockedRoomIds = useMemo(() => new Set(availability?.rooms ?? []), [availability?.rooms]);
  const blockedUnitIds = useMemo(() => new Set(availability?.units ?? []), [availability?.units]);

  const trainersLoading = trainersQuery.isLoading;
  const roomsLoading = roomsQuery.isLoading;
  const unitsLoading = unitsQuery.isLoading;
  const availabilityLoading = availabilityQuery.isLoading;

  useEffect(() => {
    if (!variant) {
      setFormValues({
        price: '',
        stock: '',
        stock_status: 'instock',
        status: 'publish',
        sede: '',
        date: '',
        trainer_id: '',
        sala_id: '',
        unidad_movil_id: '',
      });
      setInitialValues({
        price: '',
        stock: '',
        stock_status: 'instock',
        status: 'publish',
        sede: '',
        date: '',
        trainer_id: '',
        sala_id: '',
        unidad_movil_id: '',
      });
      setSaveError(null);
      setSaveSuccess(null);
      setDeals([]);
      setDealsError(null);
      setIsDealsLoading(false);
      setDealStudents({});
      setDealStudentsError(null);
      setIsDealStudentsLoading(false);
      setSelectedDealId(null);
      setSelectedDealSummary(null);
      return;
    }

    const nextValues = variantToFormValues(variant);
    setFormValues(nextValues);
    setInitialValues(nextValues);
    setSaveError(null);
    setSaveSuccess(null);
    setSelectedDealId(null);
    setSelectedDealSummary(null);
  }, [variant?.id]);

  useEffect(() => {
    let ignore = false;

    if (!variant?.id_woo) {
      setDeals([]);
      setDealsError(null);
      setIsDealsLoading(false);
      setDealStudents({});
      setDealStudentsError(null);
      setIsDealStudentsLoading(false);
      setSelectedDealId(null);
      setSelectedDealSummary(null);
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

  useEffect(() => {
    let ignore = false;

    if (!deals.length) {
      setDealStudents({});
      setDealStudentsError(null);
      setIsDealStudentsLoading(false);
      return () => {
        ignore = true;
      };
    }

    const validDeals = deals.filter((deal) => Boolean(deal.deal_id?.trim()));

    if (!validDeals.length) {
      setDealStudents({});
      setDealStudentsError(null);
      setIsDealStudentsLoading(false);
      return () => {
        ignore = true;
      };
    }

    setIsDealStudentsLoading(true);
    setDealStudentsError(null);

    (async () => {
      const results = await Promise.allSettled(
        validDeals.map(async (deal) => {
          const dealId = typeof deal.deal_id === 'string' ? deal.deal_id.trim() : '';
          const students = await fetchDealStudents(dealId);
          return { dealId, students };
        }),
      );

      if (ignore) {
        return;
      }

      const nextStudents: Record<string, SessionStudent[]> = {};
      let hadError = false;

      results.forEach((result, index) => {
        const fallbackDealId =
          typeof validDeals[index]?.deal_id === 'string' ? validDeals[index].deal_id.trim() : '';

        if (result.status === 'fulfilled') {
          const key = result.value.dealId || fallbackDealId;
          if (key) {
            nextStudents[key] = result.value.students;
          }
        } else if (fallbackDealId) {
          nextStudents[fallbackDealId] = [];
          hadError = true;
        } else {
          hadError = true;
        }
      });

      setDealStudents(nextStudents);
      setDealStudentsError(
        hadError ? 'No se pudieron cargar todos los alumnos de los presupuestos.' : null,
      );
      setIsDealStudentsLoading(false);
    })();

    return () => {
      ignore = true;
    };
  }, [deals]);

  const dealSummaryRows = useMemo(() => {
    if (!deals.length) {
      return [] as Array<{ deal: DealTag; student: SessionStudent; key: string }>;
    }

    const rows: Array<{ deal: DealTag; student: SessionStudent; key: string }> = [];

    deals.forEach((deal) => {
      const dealId = typeof deal.deal_id === 'string' ? deal.deal_id.trim() : '';
      const students = (dealId && dealStudents[dealId]) || [];

      students.forEach((student, index) => {
        const keyBase = student.id.trim().length ? student.id : `${dealId}-student-${index}`;
        rows.push({ deal, student, key: `summary-${keyBase}` });
      });
    });

    return rows;
  }, [deals, dealStudents]);

  const handleChange = (field: keyof VariantFormValues) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setFormValues((prev) => ({ ...prev, [field]: value }));
      setSaveSuccess(null);
    };

  const handleOpenDealModal = (deal: DealTag) => {
    const rawId = deal.deal_id?.trim();
    if (!rawId) {
      emitToast({ variant: 'danger', message: 'No se pudo determinar el presupuesto.' });
      return;
    }

    const products = deal.products.map((item) => {
      const rawPrice = item.price?.trim();
      const numericPrice = rawPrice && !Number.isNaN(Number(rawPrice)) ? Number(rawPrice) : null;
      return {
        id: item.id,
        deal_id: rawId,
        name: item.name ?? null,
        code: item.code ?? null,
        quantity: null,
        price: numericPrice,
        type: null,
        hours: null,
        comments: null,
        typeLabel: null,
        categoryLabel: null,
        template: null,
      };
    });

    const productNames = products
      .map((item) => {
        const rawName = item.name ?? '';
        const trimmedName = rawName.trim();
        if (trimmedName.length) {
          return trimmedName;
        }

        const rawCode = item.code ?? '';
        const trimmedCode = rawCode.trim();
        return trimmedCode;
      })
      .filter((value): value is string => value.length > 0);

    const variantWooId = variant?.id_woo != null ? String(variant.id_woo).trim() : '';
    const variantDate = typeof variant?.date === 'string' ? variant.date.trim() : '';
    const dealVariation = typeof deal.w_id_variation === 'string' ? deal.w_id_variation.trim() : '';
    const dealTrainingDate = typeof deal.a_fecha === 'string' ? deal.a_fecha.trim() : '';

    setSelectedDealSummary({
      deal_id: rawId,
      dealId: rawId,
      title: deal.title?.trim().length ? deal.title : `Presupuesto ${rawId}`,
      pipeline_label: 'Formación Abierta',
      pipeline_id: 'Formación Abierta',
      training_address: null,
      organization: null,
      person: null,
      products,
      productNames: productNames.length ? productNames : undefined,
      w_id_variation: dealVariation.length ? dealVariation : variantWooId || null,
      a_fecha: dealTrainingDate.length ? dealTrainingDate : variantDate || null,
    });
    setSelectedDealId(rawId);
  };

  const handleDealClick =
    (deal: DealTag) =>
    (event: MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => {
      event.preventDefault();
      event.stopPropagation();
      handleOpenDealModal(deal);
    };

  const handleCloseDealModal = () => {
    setSelectedDealId(null);
    setSelectedDealSummary(null);
  };

  const isDirty =
    formValues.price !== initialValues.price ||
    formValues.stock !== initialValues.stock ||
    formValues.stock_status !== initialValues.stock_status ||
    formValues.status !== initialValues.status ||
    formValues.sede !== initialValues.sede ||
    formValues.date !== initialValues.date ||
    formValues.trainer_id !== initialValues.trainer_id ||
    formValues.sala_id !== initialValues.sala_id ||
    formValues.unidad_movil_id !== initialValues.unidad_movil_id;

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
    if (formValues.trainer_id !== initialValues.trainer_id) {
      const trimmed = formValues.trainer_id.trim();
      payload.trainer_id = trimmed.length ? trimmed : null;
    }
    if (formValues.sala_id !== initialValues.sala_id) {
      const trimmed = formValues.sala_id.trim();
      payload.sala_id = trimmed.length ? trimmed : null;
    }
    if (formValues.unidad_movil_id !== initialValues.unidad_movil_id) {
      const trimmed = formValues.unidad_movil_id.trim();
      payload.unidad_movil_id = trimmed.length ? trimmed : null;
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
    <>
      <Modal
        show={!!variant}
        onHide={handleAttemptClose}
        centered
        size="lg"
        backdrop={isSaving ? 'static' : true}
        keyboard={!isSaving}
      >
      <Modal.Header closeButton className="variant-detail-modal-header">
        <div className="d-flex flex-column">
          <Modal.Title className="mb-1 text-white">Formación en Abierto</Modal.Title>
          {variant ? <div className="text-white small">{productHeaderLabel}</div> : null}
        </div>
      </Modal.Header>
      <Modal.Body className="d-flex flex-column gap-3">
        {variant && product ? (
          <div className="d-flex flex-column gap-3">
            <div>
              <p className="text-uppercase text-muted small fw-semibold mb-1">Producto</p>
              <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
                <div className="fw-semibold">{product.name ?? 'Producto sin nombre'}</div>
                <div className="fw-semibold text-nowrap">
                  Alumnos en deals: {totalDealStudentsDisplay}
                </div>
              </div>
            </div>

            {saveError && <Alert variant="danger" className="mb-0">{saveError}</Alert>}
            {saveSuccess && <Alert variant="success" className="mb-0">{saveSuccess}</Alert>}

            <Form className="d-flex flex-column gap-3">
              <Row className="g-3">
                <Col md={6}>
                  <Form.Group controlId="variantSede" className="mb-0">
                    <Form.Label>Sede</Form.Label>
                    <Form.Control
                      type="text"
                      value={formValues.sede}
                      disabled
                      readOnly
                      placeholder="Sede de la formación"
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group controlId="variantDate" className="mb-0">
                    <Form.Label>Fecha</Form.Label>
                    <Form.Control
                      type="date"
                      value={formValues.date}
                      disabled
                      readOnly
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Row className="g-3">
                <Col md={4}>
                  <Form.Group controlId="variantTrainer" className="mb-0">
                    <Form.Label>Formador</Form.Label>
                    <Form.Select
                      value={formValues.trainer_id}
                      onChange={handleChange('trainer_id')}
                      disabled={isSaving || trainersLoading || availabilityLoading}
                    >
                      <option value="">Sin formador</option>
                      {trainers.map((trainer) => {
                        const label = `${trainer.name}${trainer.apellido ? ` ${trainer.apellido}` : ''}`;
                        const blocked =
                          blockedTrainerIds.has(trainer.trainer_id) && trainer.trainer_id !== formValues.trainer_id;
                        return (
                          <option
                            key={trainer.trainer_id}
                            value={trainer.trainer_id}
                            disabled={blocked}
                          >
                            {blocked ? `${label} · No disponible` : label}
                          </option>
                        );
                      })}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group controlId="variantRoom" className="mb-0">
                    <Form.Label>Sala</Form.Label>
                    <Form.Select
                      value={formValues.sala_id}
                      onChange={handleChange('sala_id')}
                      disabled={isSaving || roomsLoading || availabilityLoading}
                    >
                      <option value="">Sin sala</option>
                      {rooms.map((room) => {
                        const label = room.sede ? `${room.name} (${room.sede})` : room.name;
                        const sedeMatches = (room.sede ?? '').trim().toLowerCase() === 'gep sabadell';
                        const disallowedBySede = variantSedeNormalized === 'sabadell' && !sedeMatches;
                        const blocked =
                          (blockedRoomIds.has(room.sala_id) && room.sala_id !== formValues.sala_id) ||
                          disallowedBySede;
                        return (
                          <option key={room.sala_id} value={room.sala_id} disabled={blocked}>
                            {blocked ? `${label} · No disponible` : label}
                          </option>
                        );
                      })}
                      {!rooms.length && !roomsLoading ? (
                        <option value="" disabled>
                          No hay salas disponibles
                        </option>
                      ) : null}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group controlId="variantUnit" className="mb-0">
                    <Form.Label>Unidad móvil</Form.Label>
                    <Form.Select
                      value={formValues.unidad_movil_id}
                      onChange={handleChange('unidad_movil_id')}
                      disabled={isSaving || unitsLoading || availabilityLoading}
                    >
                      <option value="">Sin unidad móvil</option>
                      {units.map((unit) => {
                        const label = unit.matricula ? `${unit.name} (${unit.matricula})` : unit.name;
                        const blocked =
                          blockedUnitIds.has(unit.unidad_id) && unit.unidad_id !== formValues.unidad_movil_id;
                        return (
                          <option key={unit.unidad_id} value={unit.unidad_id} disabled={blocked}>
                            {blocked ? `${label} · No disponible` : label}
                          </option>
                        );
                      })}
                    </Form.Select>
                  </Form.Group>
                </Col>
              </Row>

              <Row className="g-3">
                <Col md={3}>
                  <Form.Group controlId="variantStatus" className="mb-0">
                    <Form.Label>Estado</Form.Label>
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
                </Col>
                <Col md={3}>
                  <Form.Group controlId="variantPrice" className="mb-0">
                    <Form.Label>Precio</Form.Label>
                    <Form.Control
                      type="number"
                      step="0.01"
                      value={formValues.price}
                      disabled
                      readOnly
                      placeholder="Introduce el precio"
                    />
                  </Form.Group>
                </Col>
                <Col md={3}>
                  <Form.Group controlId="variantStock" className="mb-0">
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
                </Col>
                <Col md={3}>
                  <Form.Group controlId="variantStockStatus" className="mb-0">
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
                </Col>
              </Row>

              <Accordion className="variant-deals-accordion">
                <Accordion.Item eventKey="variant-deals">
                  <Accordion.Header>
                    <span className="text-uppercase small fw-semibold">Presupuestos asociados</span>
                    {deals.length ? (
                      <Badge bg="light" text="dark" className="ms-2">
                        {deals.length}
                      </Badge>
                    ) : null}
                  </Accordion.Header>
                  <Accordion.Body>
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
                      <ListGroup variant="flush" className="mb-0">
                        {deals.map((deal) => {
                          const dealTitle = deal.title?.trim().length
                            ? deal.title
                            : `Presupuesto ${deal.deal_id}`;
                          return (
                            <ListGroup.Item
                              action
                              key={deal.deal_id}
                              onClick={handleDealClick(deal)}
                              className="d-flex justify-content-between align-items-center"
                            >
                              <span className="fw-semibold">{dealTitle}</span>
                              <span className="text-muted small">{deal.deal_id}</span>
                            </ListGroup.Item>
                          );
                        })}
                      </ListGroup>
                    ) : (
                      <div className="text-muted small mb-0">No hay deals asociados a esta variación.</div>
                    )}
                  </Accordion.Body>
                </Accordion.Item>
              </Accordion>

              <div>
                <p className="text-uppercase text-muted small fw-semibold mb-2">
                  Resumen de presupuestos
                </p>
                {summaryError ? (
                  <Alert variant="danger" className="mb-0">
                    {summaryError}
                  </Alert>
                ) : isSummaryLoading ? (
                  <div className="d-flex align-items-center gap-2 text-muted">
                    <Spinner animation="border" size="sm" />
                    <span>Cargando resumen…</span>
                  </div>
                ) : deals.length ? (
                  dealSummaryRows.length ? (
                    <div className="table-responsive">
                      <Table
                        bordered
                        hover
                        size="sm"
                        className="mb-0 align-middle variant-deals-summary-table"
                      >
                        <thead>
                          <tr>
                            <th>Presupuesto</th>
                            <th>Nombre Empresa</th>
                            <th>Nombre Alumno</th>
                            <th>Apellido Alumno</th>
                            <th>Valor de Fundae</th>
                            <th>Valor de PO</th>
                            <th className="text-end">Alumnos</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dealSummaryRows.map(({ deal, student, key }) => (
                            <tr key={key}>
                              <td>{deal.deal_id}</td>
                              <td>{deal.organization?.name ?? '—'}</td>
                              <td>{student.nombre.trim().length ? student.nombre : '—'}</td>
                              <td>{student.apellido.trim().length ? student.apellido : '—'}</td>
                              <td>{deal.fundae_label ?? '—'}</td>
                              <td>{deal.po ?? '—'}</td>
                              <td className="text-end">1</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan={6} className="fw-semibold text-end">
                              Total alumnos
                            </td>
                            <td className="text-end fw-semibold">{totalDealStudents}</td>
                          </tr>
                        </tfoot>
                      </Table>
                    </div>
                  ) : (
                    <div className="text-muted small">
                      Los deals asociados no tienen alumnos registrados.
                    </div>
                  )
                ) : (
                  <div className="text-muted small">No hay deals asociados a esta variación.</div>
                )}
              </div>
            </Form>

          </div>
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

      <BudgetDetailModalAbierta
        dealId={selectedDealId}
        summary={selectedDealSummary}
        onClose={handleCloseDealModal}
        onNotify={emitToast}
      />
    </>
  );
}

export default function ProductVariantsList() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [activeVariant, setActiveVariant] = useState<ActiveVariant | null>(null);
  const [pendingDeletes, setPendingDeletes] = useState<Record<string, boolean>>({});
  const [variantLeadCounts, setVariantLeadCounts] = useState<Record<string, number>>({});
  const [variantLeadCountsLoading, setVariantLeadCountsLoading] = useState<Record<string, boolean>>({});
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

  useEffect(() => {
    const wooIdsToFetch = new Set<string>();

    products.forEach((product) => {
      product.variants.forEach((variant) => {
        const wooId = typeof variant.id_woo === 'string' ? variant.id_woo.trim() : '';
        if (wooId.length && variantLeadCounts[wooId] === undefined && !variantLeadCountsLoading[wooId]) {
          wooIdsToFetch.add(wooId);
        }
      });
    });

    wooIdsToFetch.forEach((wooId) => {
      setVariantLeadCountsLoading((prev) => ({ ...prev, [wooId]: true }));

      (async () => {
        try {
          const deals = await fetchDealsByVariation(wooId);
          setVariantLeadCounts((prev) => ({ ...prev, [wooId]: deals.length }));
        } catch (error) {
          console.warn('[ProductVariantsList] could not load lead count for variant', wooId, error);
          setVariantLeadCounts((prev) => ({ ...prev, [wooId]: 0 }));
        } finally {
          setVariantLeadCountsLoading((prev) => {
            const next = { ...prev };
            delete next[wooId];
            return next;
          });
        }
      })();
    });
  }, [products, variantLeadCounts, variantLeadCountsLoading]);

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
                  const variantGroups = buildVariantGroups(product.variants);

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
                          variantGroups.length > 0 ? (
                            <Accordion alwaysOpen className="mb-3">
                              {variantGroups.map((locationGroup, locationIndex) => {
                                const locationEventKey = `${product.id}-location-${locationIndex}`;

                                return (
                                  <Accordion.Item
                                    eventKey={locationEventKey}
                                    key={`${locationGroup.key}-${locationEventKey}`}
                                  >
                                    <Accordion.Header>
                                      <Stack
                                        direction="horizontal"
                                        className="w-100 justify-content-between align-items-center"
                                      >
                                        <span>{locationGroup.label}</span>
                                        <Badge bg="secondary">{locationGroup.totalVariants}</Badge>
                                      </Stack>
                                    </Accordion.Header>
                                    <Accordion.Body>
                                      {locationGroup.variantsByMonth.length > 0 ? (
                                        <Accordion alwaysOpen flush>
                                          {locationGroup.variantsByMonth.map((monthGroup, monthIndex) => {
                                            const monthEventKey = `${locationEventKey}-month-${monthIndex}`;

                                            return (
                                              <Accordion.Item
                                                eventKey={monthEventKey}
                                                key={`${locationGroup.key}-${monthGroup.key}-${monthIndex}`}
                                              >
                                                <Accordion.Header>
                                                  <Stack
                                                    direction="horizontal"
                                                    className="w-100 justify-content-between align-items-center"
                                                  >
                                                    <span>{monthGroup.label}</span>
                                                    <Badge bg="secondary">{monthGroup.variants.length}</Badge>
                                                  </Stack>
                                                </Accordion.Header>
                                                <Accordion.Body>
                                                  <ListGroup>
                                                    {monthGroup.variants.map((variant) => {
                                                      const isDeleting = !!pendingDeletes[variant.id];
                                                      const wooId =
                                                        typeof variant.id_woo === 'string'
                                                          ? variant.id_woo.trim()
                                                          : '';
                                                      const leadsCount = wooId ? variantLeadCounts[wooId] ?? 0 : null;
                                                      const isLeadCountLoading = wooId
                                                        ? !!variantLeadCountsLoading[wooId]
                                                        : false;
                                                      const budgetsBadgeBg =
                                                        !isLeadCountLoading && typeof leadsCount === 'number' && leadsCount > 0
                                                          ? 'primary'
                                                          : 'light';

                                                      return (
                                                        <ListGroup.Item
                                                          action
                                                          key={variant.id}
                                                          onClick={() => handleSelectVariant(product, variant)}
                                                          className="d-flex flex-column gap-1"
                                                        >
                                                          <div className="d-flex justify-content-between align-items-start gap-3">
                                                            <div>
                                                              <div className="fw-semibold">
                                                                {variant.name ?? 'Variante sin nombre'}
                                                              </div>
                                                              <div className="text-muted small">ID Woo: {variant.id_woo}</div>
                                                            </div>
                                                            <Stack direction="horizontal" gap={2} className="flex-wrap">
                                                              {wooId ? (
                                                                <Badge
                                                                  bg={budgetsBadgeBg}
                                                                  text={budgetsBadgeBg === 'light' ? 'dark' : undefined}
                                                                  className="d-inline-flex align-items-center gap-2"
                                                                  title={`Presupuestos asociados: ${
                                                                    isLeadCountLoading ? 'cargando…' : leadsCount
                                                                  }`}
                                                                >
                                                                  <span className="text-uppercase small mb-0">Presupuestos</span>
                                                                  {isLeadCountLoading ? (
                                                                    <Spinner
                                                                      animation="border"
                                                                      size="sm"
                                                                      role="status"
                                                                      aria-hidden="true"
                                                                    />
                                                                  ) : (
                                                                    <span className="fw-semibold">{leadsCount}</span>
                                                                  )}
                                                                </Badge>
                                                              ) : null}
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
                                                          {variant.sede && (
                                                            <div className="text-muted small">Sede: {variant.sede}</div>
                                                          )}
                                                        </ListGroup.Item>
                                                      );
                                                    })}
                                                  </ListGroup>
                                                </Accordion.Body>
                                              </Accordion.Item>
                                            );
                                          })}
                                        </Accordion>
                                      ) : (
                                        <p className="text-muted small mb-0">No hay variantes agrupadas por mes.</p>
                                      )}
                                    </Accordion.Body>
                                  </Accordion.Item>
                                );
                              })}
                            </Accordion>
                          ) : (
                            <p className="text-muted small mb-0">No hay variantes agrupadas para mostrar.</p>
                          )
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
