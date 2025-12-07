import {
  ChangeEvent,
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Collapse,
  Form,
  ListGroup,
  Modal,
  Row,
  Spinner,
  Stack,
  Table,
} from 'react-bootstrap';

import { ApiError } from '../../api/client';
import type { SessionStudent } from '../../api/sessions.types';
import { useTrainingTemplatePoints } from '../../hooks/useTrainingTemplatePoints';
import {
  fetchActiveTrainers,
  fetchMobileUnitsCatalog,
  fetchRoomsCatalog,
} from '../presupuestos/api/catalogs.api';
import { fetchSessionAvailability } from '../presupuestos/api/sessions.api';
import { fetchDealStudents } from '../presupuestos/api/students.api';
import {
  setTrainerInviteStatusForIds,
  summarizeTrainerInviteStatus,
  syncTrainerInviteStatusMap,
  type TrainerInviteStatusMap,
} from "../presupuestos/shared/trainerInviteStatus";
import { BudgetDetailModalAbierta } from '../presupuestos/abierta/BudgetDetailModalAbierta';
import type { DealSummary } from '../../types/deal';
import { emitToast } from '../../utils/toast';
import {
  createProductVariantsForProduct,
  deleteProductVariant,
  fetchDealsByVariation,
  fetchVariantComments,
  fetchProductVariant,
  fetchProductsWithVariants,
  createVariantComment,
  deleteVariantComment,
  sendVariantTrainerInvites,
  updateVariantComment,
  updateProductVariant,
  updateProductVariantDefaults,
} from './api';
import type {
  ActiveVariant,
  DealTag,
  ProductDefaults,
  ProductDefaultsUpdatePayload,
  ProductInfo,
  TrainerInviteStatus,
  VariantComment,
  VariantInfo,
  VariantLocationGroup,
  VariantMonthGroup,
  VariantUpdatePayload,
} from './types';
import { buildVariantGroups, compareVariants, findDealProductPriceForProduct } from './utils';
import { useCurrentUserIdentity } from '../presupuestos/useCurrentUserIdentity';

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
  trainer_ids: string[];
  sala_id: string;
  unidad_movil_ids: string[];
};

type VariantTrainerRecord = VariantInfo['trainers'][number];
type VariantUnitRecord = VariantInfo['unidades'][number];

const STOCK_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'instock', label: 'En stock' },
  { value: 'outofstock', label: 'Sin stock' },
  { value: 'onbackorder', label: 'En reserva' },
];

const PUBLICATION_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'publish', label: 'Publicado' },
  { value: 'private', label: 'Cancelado' },
];

const TRAINER_INVITE_STATUS_BADGES: Record<TrainerInviteStatus, { label: string; variant: string }> = {
  NOT_SENT: { label: 'Sin enviar mail', variant: 'warning' },
  PENDING: { label: 'Mail enviado', variant: 'info' },
  CONFIRMED: { label: 'Aceptada', variant: 'success' },
  DECLINED: { label: 'Rechazada', variant: 'danger' },
};

type InviteStatusState = { sending: boolean; message: string | null; error: string | null };

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
  const trainerIdSet = new Set<string>();
  if (Array.isArray(variant.trainer_ids)) {
    variant.trainer_ids.forEach((value) => {
      if (value?.trim()) {
        trainerIdSet.add(value.trim());
      }
    });
  }
  if (!trainerIdSet.size && typeof variant.trainer_id === 'string' && variant.trainer_id.trim()) {
    trainerIdSet.add(variant.trainer_id.trim());
  }
  if (Array.isArray(variant.trainers)) {
    variant.trainers.forEach((record) => {
      if (record?.trainer_id?.trim()) {
        trainerIdSet.add(record.trainer_id.trim());
      }
    });
  }
  if (variant.trainer?.trainer_id?.trim()) {
    trainerIdSet.add(variant.trainer.trainer_id.trim());
  }
  if (Array.isArray(variant.trainer_invites)) {
    variant.trainer_invites.forEach((invite) => {
      if (invite?.trainer_id?.trim()) {
        trainerIdSet.add(invite.trainer_id.trim());
      }
    });
  }
  if (variant.trainer_invite_statuses) {
    Object.keys(variant.trainer_invite_statuses).forEach((trainerId) => {
      if (trainerId?.trim()) {
        trainerIdSet.add(trainerId.trim());
      }
    });
  }

  const unitIdSet = new Set<string>();
  if (Array.isArray(variant.unidad_movil_ids)) {
    variant.unidad_movil_ids.forEach((value) => {
      if (value?.trim()) {
        unitIdSet.add(value.trim());
      }
    });
  }
  if (!unitIdSet.size && typeof variant.unidad_movil_id === 'string' && variant.unidad_movil_id.trim()) {
    unitIdSet.add(variant.unidad_movil_id.trim());
  }
  if (Array.isArray(variant.unidades)) {
    variant.unidades.forEach((record) => {
      if (record?.unidad_id?.trim()) {
        unitIdSet.add(record.unidad_id.trim());
      }
    });
  }
  if (variant.unidad?.unidad_id?.trim()) {
    unitIdSet.add(variant.unidad.unidad_id.trim());
  }

  return {
    price: variant.price ?? '',
    stock: variant.stock != null ? String(variant.stock) : '',
    stock_status: variant.stock_status ?? 'instock',
    status: variant.status ?? 'publish',
    sede: variant.sede ?? '',
    date: formatDateForInputValue(variant.date),
    trainer_ids: Array.from(trainerIdSet),
    sala_id: variant.sala_id ?? '',
    unidad_movil_ids: Array.from(unitIdSet),
  };
}

function areStringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

function sanitizeStringArray(values: string[]): string[] {
  const seen = new Set<string>();
  const sanitized: string[] = [];
  values.forEach((value) => {
    const trimmed = value.trim();
    if (!trimmed.length) {
      return;
    }
    if (seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    sanitized.push(trimmed);
  });
  return sanitized;
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
  const [combinedInput, setCombinedInput] = useState('');
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
    setCombinedInput('');
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

  const parseCombinedVariantsInput = (
    value: string,
  ): { combos: Array<{ sede: string; date: string }>; errors: string[] } => {
    const raw = value.split(';');
    const seen = new Set<string>();
    const combos: Array<{ sede: string; date: string }> = [];
    const errors: string[] = [];

    for (const chunk of raw) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;

      const [sedeRaw, ...dateParts] = trimmed.split(',');
      const sede = sedeRaw?.trim() ?? '';
      const dateRaw = dateParts.join(',').trim();

      if (!sede || !dateRaw) {
        errors.push(`Formato inválido en "${trimmed}"`);
        continue;
      }

      const match = dateRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!match) {
        errors.push(`Fecha inválida en "${trimmed}"`);
        continue;
      }

      const day = match[1].padStart(2, '0');
      const month = match[2].padStart(2, '0');
      const year = match[3];
      const normalized = `${day}/${month}/${year}`;
      const key = `${sede.toLowerCase()}|${normalized}`;

      if (seen.has(key)) continue;
      seen.add(key);
      combos.push({ sede, date: normalized });
    }

    return { combos, errors };
  };

  const formatVariantDate = (value: string | null): string => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = date.getUTCFullYear();
    return `${day}/${month}/${year}`;
  };

  const buildRequestedCombos = (
    sedes: string[],
    dates: string[],
    combined: Array<{ sede: string; date: string }>,
  ): Array<{ sede: string; date: string }> => {
    const combos: Array<{ sede: string; date: string }> = [];
    const seen = new Set<string>();

    for (const combo of combined) {
      const key = `${combo.sede.toLowerCase()}|${combo.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      combos.push(combo);
    }

    for (const sede of sedes) {
      for (const date of dates) {
        const key = `${sede.toLowerCase()}|${date}`;
        if (seen.has(key)) continue;
        seen.add(key);
        combos.push({ sede, date });
      }
    }

    return combos;
  };

  const handleSave = async () => {
    if (!product) return;
    if (isSaving) return;

    const sedes = parseSedesInput(sedesInput);
    const { values: dates, invalid } = parseDatesInput(datesInput);
    const { combos: combinedCombos, errors: combinedErrors } = parseCombinedVariantsInput(combinedInput);

    if (combinedErrors.length) {
      setError(`Revisa las variantes combinadas: ${combinedErrors.join(' ')}`);
      return;
    }

    if (invalid && datesInput.trim().length > 0) {
      setError(`Formato de fecha inválido: ${invalid}`);
      return;
    }

    if (!combinedCombos.length && !sedes.length) {
      setError('Debes indicar al menos una sede o una variante combinada.');
      return;
    }

    if (!combinedCombos.length && !dates.length) {
      setError('Debes indicar al menos una fecha o una variante combinada.');
      return;
    }

    const requestedCombos = buildRequestedCombos(sedes, dates, combinedCombos);
    if (!requestedCombos.length) {
      setError('No hay combinaciones válidas para crear.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const result = await createProductVariantsForProduct(product.id, sedes, dates, combinedCombos);
      onVariantsCreated(product.id, result);

      const createdMessage = `Se crearon ${result.created.length} variantes.`;
      const skippedMessage = result.skipped
        ? ` ${result.skipped} combinaciones ya existían.`
        : '';

      const detailSummary = result.created
        .map((variant) => {
          const dateText = formatVariantDate(variant.date);
          const sedeText = variant.sede ?? 'Sin sede';
          return dateText ? `${sedeText} (${dateText})` : sedeText;
        })
        .filter((text) => text.length > 0)
        .join('; ');

      const detailMessage = detailSummary ? ` Detalle: ${detailSummary}.` : '';

      setSuccess(result.message ?? `${createdMessage}${skippedMessage}${detailMessage}`);

      if (result.created.length) {
        setSedesInput('');
        setDatesInput('');
        setCombinedInput('');
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
  const { combos: combinedPreview, errors: combinedPreviewErrors } = parseCombinedVariantsInput(combinedInput);
  const combinationsPreview = invalidDatePreview && datesInput.trim().length > 0
    ? combinedPreview.length
    : buildRequestedCombos(sedesPreview, datesPreview, combinedPreview).length;

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
        <Form.Group controlId="variant-create-combined">
          <Form.Label>Variantes combinadas</Form.Label>
          <Form.Control
            as="textarea"
            rows={2}
            value={combinedInput}
            onChange={(event) => {
              setCombinedInput(event.target.value);
              setSuccess(null);
            }}
            placeholder="Sede,dd/mm/aaaa;Sede,dd/mm/aaaa"
            disabled={isSaving}
          />
          <Form.Text className="text-muted">
            Añade variantes ya concatenadas (sede y fecha) separadas por punto y coma.
          </Form.Text>
        </Form.Group>
        {invalidDatePreview ? (
          <div className="text-danger small">Formato de fecha inválido detectado: {invalidDatePreview}</div>
        ) : null}
        {combinedPreviewErrors.length > 0 ? (
          <div className="text-danger small">Revisa las variantes combinadas: {combinedPreviewErrors.join(' ')}</div>
        ) : null}
        {combinationsPreview > 0 ? (
          <div className="text-muted small">
            Se crearán hasta {combinationsPreview} variantes nuevas (combinaciones de sede/fecha y variantes
            concatenadas).
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
  onDealOpen,
}: {
  active: ActiveVariant | null;
  onHide: () => void;
  onVariantUpdated: (variant: VariantInfo) => void;
  onDealOpen?: (payload: { dealId: string; summary: DealSummary }) => void;
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
    trainer_ids: [],
    sala_id: '',
    unidad_movil_ids: [],
  });
  const [initialValues, setInitialValues] = useState<VariantFormValues>({
    price: '',
    stock: '',
    stock_status: 'instock',
    status: 'publish',
    sede: '',
    date: '',
    trainer_ids: [],
    sala_id: '',
    unidad_movil_ids: [],
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
  const [trainerInviteStatusMap, setTrainerInviteStatusMap] = useState<TrainerInviteStatusMap>({});
  const [initialTrainerInviteStatusMap, setInitialTrainerInviteStatusMap] = useState<TrainerInviteStatusMap>({});
  const [trainerInviteSummary, setTrainerInviteSummary] = useState<TrainerInviteStatus>('NOT_SENT');
  const [inviteStatus, setInviteStatus] = useState<InviteStatusState>({ sending: false, message: null, error: null });
  const [variantRefreshState, setVariantRefreshState] = useState<{ loading: boolean; error: string | null }>({
    loading: false,
    error: null,
  });
  const [comments, setComments] = useState<VariantComment[]>([]);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [savingComment, setSavingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentContent, setEditingCommentContent] = useState('');
  const [updatingCommentId, setUpdatingCommentId] = useState<string | null>(null);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const { userId, userName } = useCurrentUserIdentity();
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
  const normalizedUserName = useMemo(() => userName.trim().toLowerCase(), [userName]);

  const trainerDisplay = useMemo(() => {
    if (!variant) return '—';
    const trainers = Array.isArray(variant.trainers) && variant.trainers.length
      ? variant.trainers
      : variant.trainer
      ? [variant.trainer]
      : [];
    const labels = trainers
      .map((trainer) => `${trainer.name ?? ''}${trainer.apellido ? ` ${trainer.apellido}` : ''}`.trim())
      .filter((label) => label.length);
    if (labels.length) {
      return labels.join(', ');
    }
    if (Array.isArray(variant.trainer_ids) && variant.trainer_ids.length) {
      return variant.trainer_ids.join(', ');
    }
    return '—';
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
    const unidades = Array.isArray(variant.unidades) && variant.unidades.length
      ? variant.unidades
      : variant.unidad
      ? [variant.unidad]
      : [];
    const labels = unidades
      .map((unidad) => (unidad.matricula ? `${unidad.name} (${unidad.matricula})` : unidad.name))
      .map((label) => label.trim())
      .filter((label) => label.length);
    if (labels.length) {
      return labels.join(', ');
    }
    if (Array.isArray(variant.unidad_movil_ids) && variant.unidad_movil_ids.length) {
      return variant.unidad_movil_ids.join(', ');
    }
    return '—';
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

  const availableTrainerSet = useMemo(() => {
    const ids = availability?.availableTrainers ?? null;
    if (!ids || !ids.length) return null;
    return new Set(ids);
  }, [availability?.availableTrainers]);

  const trainersWithAvailability = useMemo(() => {
    if (!availableTrainerSet) return trainers;
    const selected = new Set(formValues.trainer_ids);
    return trainers.filter(
      (trainer) => availableTrainerSet.has(trainer.trainer_id) || selected.has(trainer.trainer_id),
    );
  }, [availableTrainerSet, formValues.trainer_ids, trainers]);

  const scheduleBlockedTrainerIds = useMemo(() => {
    if (!availableTrainerSet) return new Set<string>();
    const blocked = new Set<string>();
    trainers.forEach((trainer) => {
      if (!availableTrainerSet.has(trainer.trainer_id)) {
        blocked.add(trainer.trainer_id);
      }
    });
    return blocked;
  }, [availableTrainerSet, trainers]);

  const blockedTrainerIds = useMemo(() => {
    const set = new Set<string>();
    (availability?.trainers ?? []).forEach((id) => set.add(id));
    scheduleBlockedTrainerIds.forEach((id) => set.add(id));
    return set;
  }, [availability?.trainers, scheduleBlockedTrainerIds]);
  const blockedRoomIds = useMemo(() => new Set(availability?.rooms ?? []), [availability?.rooms]);
  const blockedUnitIds = useMemo(() => new Set(availability?.units ?? []), [availability?.units]);

  const trainersLoading = trainersQuery.isLoading;
  const roomsLoading = roomsQuery.isLoading;
  const unitsLoading = unitsQuery.isLoading;
  const availabilityLoading = availabilityQuery.isLoading;

  const trainerFieldRef = useRef<HTMLDivElement | null>(null);
  const trainerPointerInteractingRef = useRef(false);
  const unitFieldRef = useRef<HTMLDivElement | null>(null);
  const unitPointerInteractingRef = useRef(false);
  const [trainerListOpen, setTrainerListOpen] = useState(false);
  const [trainerFilter, setTrainerFilter] = useState('');
  const [unitListOpen, setUnitListOpen] = useState(false);
  const [unitFilter, setUnitFilter] = useState('');
  const trainerIdsRef = useRef<string[]>([]);
  const mountedRef = useRef(true);
  const hasUnsavedChangesRef = useRef(false);
  const onVariantUpdatedRef = useRef(onVariantUpdated);

  useEffect(() => {
    onVariantUpdatedRef.current = onVariantUpdated;
  }, [onVariantUpdated]);

  useEffect(() => {
    trainerIdsRef.current = formValues.trainer_ids;
  }, [formValues.trainer_ids]);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => {
    if (!variant) {
      setFormValues({
        price: '',
        stock: '',
        stock_status: 'instock',
        status: 'publish',
        sede: '',
        date: '',
        trainer_ids: [],
        sala_id: '',
        unidad_movil_ids: [],
      });
      setInitialValues({
        price: '',
        stock: '',
        stock_status: 'instock',
        status: 'publish',
        sede: '',
        date: '',
        trainer_ids: [],
        sala_id: '',
        unidad_movil_ids: [],
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
      setTrainerInviteStatusMap({});
      setInitialTrainerInviteStatusMap({});
      setTrainerInviteSummary('NOT_SENT');
      setInviteStatus({ sending: false, message: null, error: null });
      setVariantRefreshState({ loading: false, error: null });
      setComments([]);
      setCommentsError(null);
      setCommentsLoading(false);
      setNewComment('');
      setSavingComment(false);
      setEditingCommentId(null);
      setEditingCommentContent('');
      setUpdatingCommentId(null);
      setDeletingCommentId(null);
      return;
    }

    const nextValues = variantToFormValues(variant);
    setFormValues(nextValues);
    setInitialValues(nextValues);
    setSaveError(null);
    const baseStatusMap = variant.trainer_invite_statuses ?? {};
    const syncedStatusMap = syncTrainerInviteStatusMap(baseStatusMap, nextValues.trainer_ids);
    setTrainerInviteStatusMap(syncedStatusMap);
    setInitialTrainerInviteStatusMap(syncedStatusMap);
    setTrainerInviteSummary(variant.trainer_invite_status ?? 'NOT_SENT');
    setInviteStatus({ sending: false, message: null, error: null });
    setSaveSuccess(null);
    setSelectedDealId(null);
    setSelectedDealSummary(null);
    setVariantRefreshState({ loading: false, error: null });
  }, [variant]);

  useEffect(() => {
    setTrainerListOpen(false);
    setTrainerFilter('');
    trainerPointerInteractingRef.current = false;
    setUnitListOpen(false);
    setUnitFilter('');
    unitPointerInteractingRef.current = false;
  }, [variant]);

  useEffect(() => {
    let ignore = false;
    setComments([]);
    setCommentsError(null);
    setNewComment('');
    setEditingCommentId(null);
    setEditingCommentContent('');
    setUpdatingCommentId(null);
    setDeletingCommentId(null);

    const variantId = variant?.id?.trim();
    if (!variantId) {
      setCommentsLoading(false);
      return () => {
        ignore = true;
      };
    }

    setCommentsLoading(true);
    (async () => {
      try {
        const list = await fetchVariantComments(variantId);
        if (!ignore) {
          setComments(list);
        }
      } catch (error) {
        const message =
          error instanceof ApiError ? error.message : 'No se pudieron cargar los comentarios de la variante.';
        if (!ignore) {
          setCommentsError(message);
        }
      } finally {
        if (!ignore) {
          setCommentsLoading(false);
        }
      }
    })();

    return () => {
      ignore = true;
    };
  }, [variant?.id]);

  const loadVariantDetails = useCallback(
    async (variantId: string, options?: { silent?: boolean; keepFormValues?: boolean }) => {
      const normalizedId = String(variantId ?? '').trim();
      if (!normalizedId) {
        return null;
      }
      const { silent = false, keepFormValues = false } = options ?? {};
      if (!silent && mountedRef.current) {
        setVariantRefreshState({ loading: true, error: null });
      }
      try {
        const refreshed = await fetchProductVariant(normalizedId);
        if (!mountedRef.current) {
          return refreshed;
        }
        const nextValues = variantToFormValues(refreshed);
        const baseStatusMap = refreshed.trainer_invite_statuses ?? {};
        const targetTrainerIds = trainerIdsRef.current.length
          ? trainerIdsRef.current
          : nextValues.trainer_ids;
        const statusMap = syncTrainerInviteStatusMap(baseStatusMap, targetTrainerIds);
        setTrainerInviteStatusMap(statusMap);
        setTrainerInviteSummary(refreshed.trainer_invite_status ?? 'NOT_SENT');
        if (!keepFormValues && !hasUnsavedChangesRef.current) {
          setFormValues(nextValues);
          setInitialValues(nextValues);
          setInitialTrainerInviteStatusMap(statusMap);
        }
        if (!silent) {
          setVariantRefreshState({ loading: false, error: null });
        }
        onVariantUpdatedRef.current?.(refreshed);
        return refreshed;
      } catch (error) {
        if (!mountedRef.current) {
          return null;
        }
        const message = error instanceof ApiError ? error.message : 'No se pudo actualizar el estado de la variante.';
        if (!silent) {
          setVariantRefreshState({ loading: false, error: message });
        }
        return null;
      }
    },
    [
      hasUnsavedChangesRef,
      setFormValues,
      setInitialValues,
      setInitialTrainerInviteStatusMap,
      setTrainerInviteStatusMap,
      setTrainerInviteSummary,
      setVariantRefreshState,
    ],
  );

  useEffect(() => {
    if (!variant?.id) {
      setVariantRefreshState({ loading: false, error: null });
      return;
    }
    void loadVariantDetails(variant.id);
  }, [loadVariantDetails, variant?.id]);

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

  type VariantFormField = Exclude<keyof VariantFormValues, 'trainer_ids' | 'unidad_movil_ids'>;

  const handleChange = (field: VariantFormField) =>
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

    const summary: DealSummary = {
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
    };

    if (onDealOpen) {
      onDealOpen({ dealId: rawId, summary });
      onHide();
      return;
    }

    setSelectedDealSummary(summary);
    setSelectedDealId(rawId);
  };

  const handleSubmitComment = async (event?: ReactMouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    if (!variant?.id) return;

    const trimmedContent = newComment.trim();
    if (!trimmedContent.length) {
      setCommentsError('Escribe un comentario antes de guardarlo.');
      return;
    }

    setCommentsError(null);
    setSavingComment(true);
    try {
      const created = await createVariantComment(variant.id, { content: trimmedContent }, {
        id: userId,
        name: userName,
      });
      setComments((prev) => [created, ...prev]);
      setNewComment('');
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'No se pudo guardar el comentario.';
      setCommentsError(message);
    } finally {
      setSavingComment(false);
    }
  };

  const handleStartEditComment = (comment: VariantComment) => {
    setEditingCommentId(comment.id);
    setEditingCommentContent(comment.content);
    setCommentsError(null);
  };

  const handleCancelEditComment = () => {
    setEditingCommentId(null);
    setEditingCommentContent('');
    setCommentsError(null);
    setUpdatingCommentId(null);
  };

  const handleSaveCommentEdit = async () => {
    if (!variant?.id || !editingCommentId) return;
    const trimmedContent = editingCommentContent.trim();
    if (!trimmedContent.length) {
      setCommentsError('El comentario no puede estar vacío.');
      return;
    }

    setCommentsError(null);
    setUpdatingCommentId(editingCommentId);
    try {
      const updated = await updateVariantComment(
        variant.id,
        editingCommentId,
        { content: trimmedContent },
        { id: userId, name: userName },
      );
      setComments((prev) => prev.map((comment) => (comment.id === updated.id ? updated : comment)));
      setEditingCommentId(null);
      setEditingCommentContent('');
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'No se pudo actualizar el comentario.';
      setCommentsError(message);
    } finally {
      setUpdatingCommentId(null);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!variant?.id || !commentId) return;
    setCommentsError(null);
    setDeletingCommentId(commentId);
    try {
      await deleteVariantComment(variant.id, commentId, { id: userId, name: userName });
      setComments((prev) => prev.filter((comment) => comment.id !== commentId));
      if (editingCommentId === commentId) {
        setEditingCommentId(null);
        setEditingCommentContent('');
      }
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'No se pudo eliminar el comentario.';
      setCommentsError(message);
    } finally {
      setDeletingCommentId(null);
    }
  };

  const handleDealClick =
    (deal: DealTag) =>
    (event: ReactMouseEvent<HTMLButtonElement | HTMLAnchorElement>) => {
      event.preventDefault();
      event.stopPropagation();
      handleOpenDealModal(deal);
    };

  const handleCloseDealModal = () => {
    setSelectedDealId(null);
    setSelectedDealSummary(null);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (trainerFieldRef.current && !trainerFieldRef.current.contains(target)) {
        setTrainerListOpen(false);
        trainerPointerInteractingRef.current = false;
      }
      if (unitFieldRef.current && !unitFieldRef.current.contains(target)) {
        setUnitListOpen(false);
        unitPointerInteractingRef.current = false;
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const normalizedTrainerFilter = trainerFilter.trim().toLowerCase();
  const normalizedUnitFilter = unitFilter.trim().toLowerCase();

  const filteredTrainers = useMemo(() => {
    if (!normalizedTrainerFilter.length) {
      return trainersWithAvailability;
    }
    return trainersWithAvailability.filter((trainer) => {
      const label = `${trainer.name}${trainer.apellido ? ` ${trainer.apellido}` : ''}`.trim();
      return label.toLowerCase().includes(normalizedTrainerFilter);
    });
  }, [normalizedTrainerFilter, trainersWithAvailability]);

  const filteredUnits = useMemo(() => {
    if (!normalizedUnitFilter.length) {
      return units;
    }
    return units.filter((unit) => {
      const label = unit.matricula ? `${unit.name} (${unit.matricula})` : unit.name;
      return label.toLowerCase().includes(normalizedUnitFilter);
    });
  }, [normalizedUnitFilter, units]);

  const trainerLookup = useMemo(() => {
    const map = new Map<string, VariantTrainerRecord>();

    trainers.forEach((trainer) => {
      map.set(trainer.trainer_id, {
        trainer_id: trainer.trainer_id,
        name: trainer.name,
        apellido: trainer.apellido ?? null,
        dni: trainer.dni ?? null,
      });
    });

    if (variant) {
      const records = Array.isArray(variant.trainers) && variant.trainers.length
        ? variant.trainers
        : variant.trainer
        ? [variant.trainer]
        : [];

      records.forEach((record) => {
        if (!record?.trainer_id) {
          return;
        }
        if (!map.has(record.trainer_id)) {
          map.set(record.trainer_id, {
            trainer_id: record.trainer_id,
            name: record.name ?? null,
            apellido: record.apellido ?? null,
            dni: record.dni ?? null,
          });
        }
      });
    }

    return map;
  }, [trainers, variant]);

  const unitLookup = useMemo(() => {
    const map = new Map<string, VariantUnitRecord>();

    units.forEach((unit) => {
      map.set(unit.unidad_id, {
        unidad_id: unit.unidad_id,
        name: unit.name,
        matricula: unit.matricula ?? null,
      });
    });

    if (variant) {
      const records = Array.isArray(variant.unidades) && variant.unidades.length
        ? variant.unidades
        : variant.unidad
        ? [variant.unidad]
        : [];

      records.forEach((record) => {
        if (!record?.unidad_id) {
          return;
        }
        if (!map.has(record.unidad_id)) {
          map.set(record.unidad_id, {
            unidad_id: record.unidad_id,
            name: record.name,
            matricula: record.matricula ?? null,
          });
        }
      });
    }

    return map;
  }, [units, variant]);

  const selectedTrainers = useMemo(() => {
    if (!formValues.trainer_ids.length) {
      return [] as VariantTrainerRecord[];
    }

    return formValues.trainer_ids.map((trainerId) =>
      trainerLookup.get(trainerId) ?? {
        trainer_id: trainerId,
        name: trainerId,
        apellido: null,
        dni: null,
      },
    );
  }, [formValues.trainer_ids, trainerLookup]);

  const trainerInviteDetails = useMemo(
    () =>
      selectedTrainers.map((trainer, index) => {
        const trainerId = trainer.trainer_id;
        const status: TrainerInviteStatus = trainerId
          ? trainerInviteStatusMap[trainerId] ?? 'NOT_SENT'
          : 'NOT_SENT';
        const badgeInfo = TRAINER_INVITE_STATUS_BADGES[status] ?? TRAINER_INVITE_STATUS_BADGES.NOT_SENT;
        const labelParts = [trainer.name, trainer.apellido].filter((value) => value && value.trim().length);
        const label = labelParts.length
          ? labelParts.join(' ')
          : trainerId && trainerId.trim().length
          ? trainerId
          : `Formador ${index + 1}`;
        return {
          key: trainerId && trainerId.trim().length ? trainerId : `trainer-${index}`,
          label,
          status,
          badge: badgeInfo,
        };
      }),
    [selectedTrainers, trainerInviteStatusMap],
  );

  const hasPendingInviteTargets = trainerInviteDetails.some((item) => item.status === 'NOT_SENT');
  const hasUnsavedTrainerChanges = useMemo(
    () => !areStringArraysEqual(formValues.trainer_ids, initialValues.trainer_ids),
    [formValues.trainer_ids, initialValues.trainer_ids],
  );

  const selectedUnits = useMemo(() => {
    if (!formValues.unidad_movil_ids.length) {
      return [] as VariantUnitRecord[];
    }

    return formValues.unidad_movil_ids.map((unitId) =>
      unitLookup.get(unitId) ?? {
        unidad_id: unitId,
        name: unitId,
        matricula: null,
      },
    );
  }, [formValues.unidad_movil_ids, unitLookup]);

  const trainerSummary = useMemo(() => {
    const labels = selectedTrainers
      .map((trainer) => {
        const label = `${trainer.name ?? ''}${trainer.apellido ? ` ${trainer.apellido}` : ''}`.trim();
        return label.length ? label : trainer.trainer_id;
      })
      .filter((label) => label.length);

    if (labels.length) {
      return labels.join(', ');
    }

    return '';
  }, [selectedTrainers]);

  const unitSummary = useMemo(() => {
    const labels = selectedUnits
      .map((unit) => {
        const label = unit.matricula ? `${unit.name} (${unit.matricula})` : unit.name;
        const trimmed = label.trim();
        return trimmed.length ? trimmed : unit.unidad_id;
      })
      .filter((label) => label.length);

    if (labels.length) {
      return labels.join(', ');
    }

    return '';
  }, [selectedUnits]);

  const trainerSummaryDisplay = trainerSummary || trainerDisplay;
  const unitSummaryDisplay = unitSummary || unitDisplay;

  const formationLabel = useMemo(() => {
    const label = (product?.name ?? product?.code ?? '').trim();
    return label.length ? label : '—';
  }, [product?.code, product?.name]);

  const templateId = useMemo(() => {
    const raw = typeof product?.template === 'string' ? product.template.trim() : '';
    return raw.length ? raw : null;
  }, [product?.template]);

  const trainingPoints = useTrainingTemplatePoints(templateId);

  const handleCopyFundae = useCallback(async () => {
    const trainerDetails = selectedTrainers.map((trainer) => {
      const labelParts = [trainer.name, trainer.apellido]
        .filter((value) => value && value.trim().length)
        .join(' ');
      const label = labelParts.length ? labelParts : trainer.trainer_id;
      const dni = trainer.dni?.trim();
      const dniLabel = dni?.length ? dni : 'DNI no disponible';
      return `${label} - ${dniLabel}`;
    });

    const trainersText = trainerDetails.length ? trainerDetails.join(', ') : 'Sin formadores asignados';
    const pointsLabel = trainingPoints?.trim() || '—';
    const payload = [
      `Formador o Formadores: ${trainersText}`,
      'Telefono: 935 646 346',
      'Mail: formacion@gepgroup.es',
      `Formación: ${formationLabel}`,
      `Puntos formación: ${pointsLabel}`,
    ].join('\n');

    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error('Clipboard API no disponible');
      }
      await navigator.clipboard.writeText(payload);
      emitToast({ variant: 'success', message: 'Datos FUNDAE copiados al portapapeles.' });
    } catch (error) {
      emitToast({ variant: 'danger', message: 'No se pudieron copiar los datos de FUNDAE.' });
    }
  }, [formationLabel, selectedTrainers, trainingPoints]);

  const handleTrainerToggle = (trainerId: string, checked: boolean) => {
    let nextIds: string[] = [];
    setFormValues((prev) => {
      const set = new Set(prev.trainer_ids);
      if (checked) {
        set.add(trainerId);
      } else {
        set.delete(trainerId);
      }
      nextIds = Array.from(set);
      return { ...prev, trainer_ids: nextIds };
    });
    setTrainerInviteStatusMap((current) => {
      let nextMap = syncTrainerInviteStatusMap(current, nextIds);
      if (checked) {
        nextMap = setTrainerInviteStatusForIds(nextMap, [trainerId], 'NOT_SENT');
      }
      setTrainerInviteSummary(summarizeTrainerInviteStatus(nextMap));
      return nextMap;
    });
    setInviteStatus({ sending: false, message: null, error: null });
    setSaveSuccess(null);
  };

  const handleSendInvites = useCallback(async () => {
    if (!variant) return;
    const variantId = String(variant.id ?? '').trim();
    if (!variantId) return;

    if (hasUnsavedTrainerChanges) {
      setInviteStatus({
        sending: false,
        message: null,
        error: 'Guarda la variante antes de enviar la confirmación.',
      });
      return;
    }

    if (!hasPendingInviteTargets) {
      setInviteStatus({
        sending: false,
        message: 'Todos los formadores ya han recibido la invitación.',
        error: null,
      });
      return;
    }

    setInviteStatus({ sending: true, message: null, error: null });

    try {
      const response = await sendVariantTrainerInvites(variantId);
      const sentTrainerIds = response.invites
        .filter((invite) => invite.status === 'SENT')
        .map((invite) => invite.trainerId)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

      setTrainerInviteStatusMap((current) => {
        const synced = syncTrainerInviteStatusMap(current, formValues.trainer_ids);
        const nextMap = sentTrainerIds.length
          ? setTrainerInviteStatusForIds(synced, sentTrainerIds, 'PENDING')
          : synced;
        setTrainerInviteSummary(summarizeTrainerInviteStatus(nextMap));
        return nextMap;
      });
      setInitialTrainerInviteStatusMap((current) => {
        const synced = syncTrainerInviteStatusMap(current, formValues.trainer_ids);
        return sentTrainerIds.length
          ? setTrainerInviteStatusForIds(synced, sentTrainerIds, 'PENDING')
          : synced;
      });

      const sentCount = response.invites.filter((invite) => invite.status === 'SENT').length;
      const failedCount = response.invites.filter((invite) => invite.status === 'FAILED').length;
      const skippedNames = response.skippedTrainers
        .map((trainer) => [trainer.name, trainer.apellido].filter(Boolean).join(' ').trim())
        .filter((value) => value.length);

      const parts: string[] = [];
      if (sentCount) parts.push(`${sentCount} invitación${sentCount === 1 ? '' : 'es'} enviadas`);
      if (failedCount) parts.push(`${failedCount} invitación${failedCount === 1 ? '' : 'es'} con error`);
      if (!sentCount && !failedCount) parts.push('No se enviaron invitaciones');
      if (skippedNames.length) parts.push(`Sin email: ${skippedNames.join(', ')}`);

      const message = parts.join('. ');
      const hasSuccess = sentCount > 0;

      void loadVariantDetails(variantId, { silent: true, keepFormValues: true });

      setInviteStatus({
        sending: false,
        message,
        error: hasSuccess ? null : message,
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'No se pudo enviar la invitación.';
      setInviteStatus({ sending: false, message: null, error: message });
    }
  }, [
    formValues.trainer_ids,
    hasPendingInviteTargets,
    hasUnsavedTrainerChanges,
    loadVariantDetails,
    variant,
  ]);

  const handleUnitToggle = (unitId: string, checked: boolean) => {
    setFormValues((prev) => {
      const set = new Set(prev.unidad_movil_ids);
      if (checked) {
        set.add(unitId);
      } else {
        set.delete(unitId);
      }
      return { ...prev, unidad_movil_ids: Array.from(set) };
    });
    setSaveSuccess(null);
  };

  const isDirty = useMemo(
    () =>
      formValues.price !== initialValues.price ||
      formValues.stock !== initialValues.stock ||
      formValues.stock_status !== initialValues.stock_status ||
      formValues.status !== initialValues.status ||
      formValues.sede !== initialValues.sede ||
      formValues.date !== initialValues.date ||
      !areStringArraysEqual(formValues.trainer_ids, initialValues.trainer_ids) ||
      formValues.sala_id !== initialValues.sala_id ||
      !areStringArraysEqual(formValues.unidad_movil_ids, initialValues.unidad_movil_ids),
    [formValues, initialValues],
  );

  useEffect(() => {
    hasUnsavedChangesRef.current = isDirty;
  }, [isDirty]);

  const handleSave = async (closeAfter: boolean) => {
    if (!variant) return;
    if (isSaving) return;

    const variantId = String(variant.id ?? '').trim();
    if (!variantId) {
      return;
    }

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
    if (!areStringArraysEqual(formValues.trainer_ids, initialValues.trainer_ids)) {
      payload.trainer_ids = sanitizeStringArray(formValues.trainer_ids);
    }
    if (formValues.sala_id !== initialValues.sala_id) {
      const trimmed = formValues.sala_id.trim();
      payload.sala_id = trimmed.length ? trimmed : null;
    }
    if (!areStringArraysEqual(formValues.unidad_movil_ids, initialValues.unidad_movil_ids)) {
      payload.unidad_movil_ids = sanitizeStringArray(formValues.unidad_movil_ids);
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

      let enhancedVariant: VariantInfo = updated;

      if (payload.trainer_ids) {
        const sanitizedTrainerIds = sanitizeStringArray(payload.trainer_ids);
        const trainerRecords = sanitizedTrainerIds.map((trainerId) => {
          const catalogTrainer = trainers.find((item) => item.trainer_id === trainerId);
          if (catalogTrainer) {
            return {
              trainer_id: catalogTrainer.trainer_id,
              name: catalogTrainer.name,
              apellido: catalogTrainer.apellido ?? null,
              dni: catalogTrainer.dni ?? null,
            } satisfies VariantTrainerRecord;
          }

          const updatedRecord = updated.trainers.find((record) => record.trainer_id === trainerId);
          if (updatedRecord) {
            return updatedRecord;
          }

          const previousRecord = variant.trainers.find((record) => record.trainer_id === trainerId);
          if (previousRecord) {
            return previousRecord;
          }

          const updatedSingle =
            updated.trainer && updated.trainer.trainer_id === trainerId ? updated.trainer : null;
          if (updatedSingle) {
            return updatedSingle;
          }

          const previousSingle =
            variant.trainer && variant.trainer.trainer_id === trainerId ? variant.trainer : null;
          if (previousSingle) {
            return previousSingle;
          }

          return {
            trainer_id: trainerId,
            name: trainerId,
            apellido: null,
            dni: null,
          } satisfies VariantTrainerRecord;
        });

        const primaryTrainer = trainerRecords[0] ?? null;

        enhancedVariant = {
          ...enhancedVariant,
          trainer_ids: sanitizedTrainerIds,
          trainer_id: primaryTrainer?.trainer_id ?? null,
          trainer: primaryTrainer,
          trainers: trainerRecords,
        };
      }

      if (payload.unidad_movil_ids) {
        const sanitizedUnitIds = sanitizeStringArray(payload.unidad_movil_ids);
        const unitRecords = sanitizedUnitIds.map((unitId) => {
          const catalogUnit = units.find((item) => item.unidad_id === unitId);
          if (catalogUnit) {
            return {
              unidad_id: catalogUnit.unidad_id,
              name: catalogUnit.name,
              matricula: catalogUnit.matricula ?? null,
            } satisfies VariantUnitRecord;
          }

          const updatedRecord = updated.unidades.find((record) => record.unidad_id === unitId);
          if (updatedRecord) {
            return updatedRecord;
          }

          const previousRecord = variant.unidades.find((record) => record.unidad_id === unitId);
          if (previousRecord) {
            return previousRecord;
          }

          const updatedSingle =
            updated.unidad && updated.unidad.unidad_id === unitId ? updated.unidad : null;
          if (updatedSingle) {
            return updatedSingle;
          }

          const previousSingle =
            variant.unidad && variant.unidad.unidad_id === unitId ? variant.unidad : null;
          if (previousSingle) {
            return previousSingle;
          }

          return {
            unidad_id: unitId,
            name: unitId,
            matricula: null,
          } satisfies VariantUnitRecord;
        });

        const primaryUnit = unitRecords[0] ?? null;

        enhancedVariant = {
          ...enhancedVariant,
          unidad_movil_ids: sanitizedUnitIds,
          unidad_movil_id: primaryUnit?.unidad_id ?? null,
          unidad: primaryUnit,
          unidades: unitRecords,
        };
      }

      onVariantUpdated(enhancedVariant);

      const nextValues = variantToFormValues(enhancedVariant);
      setFormValues(nextValues);
      setInitialValues(nextValues);
      setSaveSuccess(closeAfter ? null : 'Variante actualizada correctamente.');
      const updatedStatusMap = syncTrainerInviteStatusMap(
        enhancedVariant.trainer_invite_statuses ?? {},
        nextValues.trainer_ids,
      );
      setTrainerInviteStatusMap(updatedStatusMap);
      setInitialTrainerInviteStatusMap(updatedStatusMap);
      setTrainerInviteSummary(enhancedVariant.trainer_invite_status ?? 'NOT_SENT');

      void loadVariantDetails(variantId, { keepFormValues: true });

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

            <Row className="g-3">
              <Col md={4}>
                <div className="d-flex flex-column">
                  <span className="text-uppercase text-muted small fw-semibold">Formadores asignados</span>
                  <span>{trainerDisplay}</span>
                </div>
              </Col>
              <Col md={4}>
                <div className="d-flex flex-column">
                  <span className="text-uppercase text-muted small fw-semibold">Sala asignada</span>
                  <span>{roomDisplay}</span>
                </div>
              </Col>
              <Col md={4}>
                <div className="d-flex flex-column">
                  <span className="text-uppercase text-muted small fw-semibold">Unidades móviles asignadas</span>
                  <span>{unitDisplay}</span>
                </div>
              </Col>
            </Row>

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
                    <Form.Label>Formadores</Form.Label>
                    <div ref={trainerFieldRef} className="session-multiselect">
                      <Form.Control
                        type="text"
                        readOnly
                        placeholder="Selecciona formadores"
                        value={trainerSummaryDisplay}
                        aria-expanded={trainerListOpen}
                        aria-controls="variant-trainer-options"
                        className="session-multiselect-summary"
                        disabled={isSaving || trainersLoading || availabilityLoading}
                        onMouseDown={() => {
                          trainerPointerInteractingRef.current = true;
                        }}
                        onClick={() => {
                          if (isSaving || trainersLoading || availabilityLoading) return;
                          setTrainerListOpen((open) => !open);
                          trainerPointerInteractingRef.current = false;
                        }}
                        onFocus={() => {
                          if (isSaving || trainersLoading || availabilityLoading) return;
                          if (!trainerPointerInteractingRef.current) {
                            setTrainerListOpen(true);
                          }
                        }}
                        onBlur={() => {
                          trainerPointerInteractingRef.current = false;
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            if (isSaving || trainersLoading || availabilityLoading) return;
                            setTrainerListOpen((open) => !open);
                          } else if (event.key === 'Escape') {
                            setTrainerListOpen(false);
                          }
                        }}
                        title={trainerSummaryDisplay || 'Sin formadores'}
                      />
                      <Collapse in={trainerListOpen && !isSaving && !trainersLoading && !availabilityLoading}>
                        <div id="variant-trainer-options" className="session-multiselect-panel mt-2">
                          <Form.Control
                            type="search"
                            placeholder="Buscar"
                            value={trainerFilter}
                            onChange={(event) => setTrainerFilter(event.target.value)}
                            className="mb-2"
                          />
                          <div className="border rounded overflow-auto" style={{ maxHeight: 200 }}>
                            <ListGroup variant="flush">
                              {filteredTrainers.map((trainer) => {
                                const label = `${trainer.name}${trainer.apellido ? ` ${trainer.apellido}` : ''}`;
                                const checked = formValues.trainer_ids.includes(trainer.trainer_id);
                                const blocked = blockedTrainerIds.has(trainer.trainer_id);
                                const disabled = blocked && !checked;
                                const displayLabel = blocked ? `${label} · No disponible` : label;
                                return (
                                  <ListGroup.Item
                                    key={trainer.trainer_id}
                                    className={`py-1${blocked ? ' session-option-unavailable' : ''}`}
                                  >
                                    <Form.Check
                                      type="checkbox"
                                      id={`variant-trainer-${trainer.trainer_id}`}
                                      className={blocked ? 'session-option-unavailable' : undefined}
                                      label={displayLabel}
                                      checked={checked}
                                      disabled={disabled}
                                      onChange={(event) => {
                                        if (disabled) {
                                          return;
                                        }
                                        handleTrainerToggle(trainer.trainer_id, event.target.checked);
                                      }}
                                    />
                                  </ListGroup.Item>
                                );
                              })}
                              {!filteredTrainers.length ? (
                                <ListGroup.Item className="text-muted py-2">Sin resultados</ListGroup.Item>
                              ) : null}
                            </ListGroup>
                          </div>
                        </div>
                      </Collapse>
                    </div>
                  </Form.Group>
                {selectedTrainers.length ? (
                  <div className="mt-2">
                    {variantRefreshState.loading ? (
                      <div className="text-muted small">Actualizando confirmaciones…</div>
                    ) : variantRefreshState.error ? (
                      <div className="text-danger small">{variantRefreshState.error}</div>
                    ) : null}
                    <div className="d-flex flex-column gap-1">
                      {trainerInviteDetails.map((item) => (
                        <div key={item.key} className="d-flex align-items-center gap-2 small">
                          <span>{item.label}</span>
                          <Badge bg={item.badge.variant}>{item.badge.label}</Badge>
                          </div>
                        ))}
                      </div>
                    <div className="mt-2 d-flex flex-column gap-1">
                      <div className="d-flex flex-wrap align-items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline-primary"
                          disabled={
                            inviteStatus.sending || !hasPendingInviteTargets || hasUnsavedTrainerChanges
                          }
                          onClick={() => {
                            void handleSendInvites();
                          }}
                        >
                          {inviteStatus.sending ? (
                            <>
                              <Spinner animation="border" size="sm" role="status" className="me-2" />
                              Enviando…
                            </>
                          ) : (
                            'Enviar confirmación'
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={handleCopyFundae}
                          disabled={inviteStatus.sending}
                        >
                          Copiar FUNDAE
                        </Button>
                      </div>
                        {inviteStatus.error ? (
                          <div className="text-danger small">{inviteStatus.error}</div>
                        ) : hasUnsavedTrainerChanges ? (
                          <div className="text-muted small">
                            Guarda los cambios de la variante antes de enviar la confirmación.
                          </div>
                        ) : inviteStatus.message ? (
                          <div className="text-muted small">{inviteStatus.message}</div>
                        ) : !hasPendingInviteTargets ? (
                          <div className="text-muted small">
                            Todos los formadores ya han recibido la invitación.
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
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
                    <Form.Label>Unidades móviles</Form.Label>
                    <div ref={unitFieldRef} className="session-multiselect">
                      <Form.Control
                        type="text"
                        readOnly
                        placeholder="Selecciona unidades móviles"
                        value={unitSummaryDisplay}
                        aria-expanded={unitListOpen}
                        aria-controls="variant-unit-options"
                        className="session-multiselect-summary"
                        disabled={isSaving || unitsLoading || availabilityLoading}
                        onMouseDown={() => {
                          unitPointerInteractingRef.current = true;
                        }}
                        onClick={() => {
                          if (isSaving || unitsLoading || availabilityLoading) return;
                          setUnitListOpen((open) => !open);
                          unitPointerInteractingRef.current = false;
                        }}
                        onFocus={() => {
                          if (isSaving || unitsLoading || availabilityLoading) return;
                          if (!unitPointerInteractingRef.current) {
                            setUnitListOpen(true);
                          }
                        }}
                        onBlur={() => {
                          unitPointerInteractingRef.current = false;
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            if (isSaving || unitsLoading || availabilityLoading) return;
                            setUnitListOpen((open) => !open);
                          } else if (event.key === 'Escape') {
                            setUnitListOpen(false);
                          }
                        }}
                        title={unitSummaryDisplay || 'Sin unidades móviles'}
                      />
                      <Collapse in={unitListOpen && !isSaving && !unitsLoading && !availabilityLoading}>
                        <div id="variant-unit-options" className="session-multiselect-panel mt-2">
                          <Form.Control
                            type="search"
                            placeholder="Buscar"
                            value={unitFilter}
                            onChange={(event) => setUnitFilter(event.target.value)}
                            className="mb-2"
                          />
                          <div className="border rounded overflow-auto" style={{ maxHeight: 200 }}>
                            <ListGroup variant="flush">
                              {filteredUnits.map((unit) => {
                                const label = unit.matricula ? `${unit.name} (${unit.matricula})` : unit.name;
                                const checked = formValues.unidad_movil_ids.includes(unit.unidad_id);
                                const blocked = blockedUnitIds.has(unit.unidad_id);
                                const disabled = blocked && !checked;
                                const displayLabel = blocked ? `${label} · No disponible` : label;
                                return (
                                  <ListGroup.Item
                                    key={unit.unidad_id}
                                    className={`py-1${blocked ? ' session-option-unavailable' : ''}`}
                                  >
                                    <Form.Check
                                      type="checkbox"
                                      id={`variant-unit-${unit.unidad_id}`}
                                      className={blocked ? 'session-option-unavailable' : undefined}
                                      label={displayLabel}
                                      checked={checked}
                                      disabled={disabled}
                                      onChange={(event) => {
                                        if (disabled) {
                                          return;
                                        }
                                        handleUnitToggle(unit.unidad_id, event.target.checked);
                                      }}
                                    />
                                  </ListGroup.Item>
                                );
                              })}
                              {!filteredUnits.length ? (
                                <ListGroup.Item className="text-muted py-2">Sin resultados</ListGroup.Item>
                              ) : null}
                            </ListGroup>
                          </div>
                        </div>
                      </Collapse>
                    </div>
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

              <Accordion className="variant-comments-accordion">
                <Accordion.Item eventKey="variant-comments">
                  <Accordion.Header>
                    <span className="text-uppercase small fw-semibold">Comentarios</span>
                    {comments.length ? (
                      <Badge bg="light" text="dark" className="ms-2">
                        {comments.length}
                      </Badge>
                    ) : null}
                  </Accordion.Header>
                  <Accordion.Body>
                    {commentsError ? (
                      <Alert variant="danger" className="mb-3">
                        {commentsError}
                      </Alert>
                    ) : null}

                    {commentsLoading ? (
                      <div className="d-flex align-items-center gap-2 text-muted mb-3">
                        <Spinner animation="border" size="sm" />
                        <span>Cargando comentarios…</span>
                      </div>
                    ) : null}

                    {!commentsLoading && !comments.length ? (
                      <div className="text-muted small mb-3">Sin comentarios</div>
                    ) : null}

                    {comments.length ? (
                      <ListGroup className="mb-3">
                        {comments.map((comment) => {
                          const canEdit =
                            normalizedUserName.length &&
                            normalizedUserName === comment.author.trim().toLowerCase();
                          const isEditing = editingCommentId === comment.id;
                          const isDeleting = deletingCommentId === comment.id;
                          const isUpdating = updatingCommentId === comment.id;
                          const createdLabel = comment.created_at ? formatDate(comment.created_at) : null;

                          return (
                            <ListGroup.Item key={comment.id} className="d-flex flex-column gap-2">
                              <div className="d-flex justify-content-between align-items-start gap-2">
                                <div className="d-flex flex-column">
                                  <span className="fw-semibold">{comment.author || '—'}</span>
                                  {createdLabel ? <small className="text-muted">{createdLabel}</small> : null}
                                </div>
                                {canEdit ? (
                                  <div className="d-flex gap-2">
                                    {isEditing ? (
                                      <>
                                        <Button
                                          size="sm"
                                          variant="outline-secondary"
                                          onClick={handleCancelEditComment}
                                          disabled={isUpdating}
                                        >
                                          Cancelar
                                        </Button>
                                        <Button
                                          size="sm"
                                          onClick={handleSaveCommentEdit}
                                          disabled={isUpdating || !editingCommentContent.trim().length}
                                        >
                                          {isUpdating ? (
                                            <Spinner animation="border" size="sm" className="me-2" />
                                          ) : null}
                                          Guardar
                                        </Button>
                                      </>
                                    ) : (
                                      <>
                                        <Button
                                          size="sm"
                                          variant="outline-secondary"
                                          onClick={() => handleStartEditComment(comment)}
                                        >
                                          Editar
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline-danger"
                                          onClick={() => handleDeleteComment(comment.id)}
                                          disabled={isDeleting}
                                        >
                                          {isDeleting ? (
                                            <Spinner animation="border" size="sm" className="me-2" />
                                          ) : null}
                                          Eliminar
                                        </Button>
                                      </>
                                    )}
                                  </div>
                                ) : null}
                              </div>

                              {isEditing ? (
                                <Form.Control
                                  as="textarea"
                                  rows={3}
                                  value={editingCommentContent}
                                  onChange={(event) => setEditingCommentContent(event.target.value)}
                                  disabled={isUpdating}
                                />
                              ) : (
                                <div style={{ whiteSpace: 'pre-wrap' }}>{comment.content}</div>
                              )}
                            </ListGroup.Item>
                          );
                        })}
                      </ListGroup>
                    ) : null}

                    <Form onSubmit={(event) => event.preventDefault()}>
                      <Form.Group className="mb-2">
                        <Form.Label className="fw-semibold">Añadir comentario</Form.Label>
                        <Form.Control
                          as="textarea"
                          rows={2}
                          value={newComment}
                          onChange={(event) => setNewComment(event.target.value)}
                          disabled={savingComment}
                        />
                      </Form.Group>
                      <div className="d-flex justify-content-end">
                        <Button
                          size="sm"
                          onClick={handleSubmitComment}
                          disabled={savingComment || !newComment.trim().length}
                        >
                          {savingComment ? <Spinner animation="border" size="sm" className="me-2" /> : null}
                          Guardar comentario
                        </Button>
                      </div>
                    </Form>
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

      {!onDealOpen ? (
        <BudgetDetailModalAbierta
          dealId={selectedDealId}
          summary={selectedDealSummary}
          onClose={handleCloseDealModal}
          onNotify={emitToast}
        />
      ) : null}
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
