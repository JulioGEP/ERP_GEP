// frontend/src/features/calendar/api.ts
import { API_BASE, ApiError, type SessionEstado } from '../presupuestos/api';

export type CalendarVariantProduct = {
  id: string;
  id_woo: string | null;
  name: string | null;
  code: string | null;
  category: string | null;
  hora_inicio: string | null;
  hora_fin: string | null;
  default_variant_start: string | null;
  default_variant_end: string | null;
  default_variant_stock_status: string | null;
  default_variant_stock_quantity: number | null;
  default_variant_price: string | null;
};

export type CalendarVariantDetails = {
  id: string;
  id_woo: string | null;
  name: string | null;
  status: string | null;
  price: string | null;
  stock: number | null;
  stock_status: string | null;
  sede: string | null;
  date: string | null;
  trainer_id: string | null;
  trainer: { trainer_id: string | null; name: string | null; apellido: string | null } | null;
  sala_id: string | null;
  sala: { sala_id: string | null; name: string | null; sede: string | null } | null;
  unidad_movil_id: string | null;
  unidad: { unidad_id: string | null; name: string | null; matricula: string | null } | null;
  students_total: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type CalendarVariantEvent = {
  id: string;
  start: string;
  end: string;
  product: CalendarVariantProduct;
  variant: CalendarVariantDetails;
};

export type CalendarResource = {
  id: string;
  name: string;
  secondary?: string | null;
};

export type CalendarTrainer = CalendarResource;
export type CalendarUnit = CalendarResource;

export type CalendarSession = {
  id: string;
  dealId: string;
  dealTitle: string | null;
  dealAddress: string | null;
  dealPipelineId: string | null;
  productId: string;
  productName: string | null;
  productCode: string | null;
  title: string;
  start: string;
  end: string;
  estado: SessionEstado;
  direccion: string | null;
  comentarios: string | null;
  room: CalendarResource | null;
  trainers: CalendarTrainer[];
  units: CalendarUnit[];
};

export type CalendarSessionsParams = {
  start: string;
  end: string;
  dealId?: string;
  productId?: string;
  roomId?: string;
  trainerId?: string;
  unitId?: string;
  estados?: SessionEstado[];
};

export type CalendarSessionsResponse = {
  range: { start: string; end: string };
  sessions: CalendarSession[];
};

export type CalendarVariantsParams = {
  start: string;
  end: string;
};

export type CalendarVariantsResponse = {
  range: { start: string; end: string };
  variants: CalendarVariantEvent[];
};

const SESSION_ESTADO_VALUES: SessionEstado[] = [
  'BORRADOR',
  'PLANIFICADA',
  'SUSPENDIDA',
  'CANCELADA',
  'FINALIZADA',
];

function toTrimmed(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function toOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value);
  return text.trim().length ? text : null;
}

function toSessionEstado(value: unknown): SessionEstado {
  const text = toTrimmed(value);
  if (!text) return 'BORRADOR';
  const normalized = text.toUpperCase();
  return SESSION_ESTADO_VALUES.includes(normalized as SessionEstado)
    ? (normalized as SessionEstado)
    : 'BORRADOR';
}

function toResource(value: any): CalendarResource | null {
  const id = toTrimmed(value?.id ?? value?.sala_id ?? value?.trainer_id ?? value?.unidad_id);
  const name = toTrimmed(value?.name);
  if (!id || !name) return null;
  const secondary = toOptionalString(value?.sede ?? value?.apellido ?? value?.matricula ?? value?.secondary);
  return { id, name, secondary };
}

function ensureUniqueResources(resources: (CalendarResource | null)[]): CalendarResource[] {
  const seen = new Set<string>();
  const output: CalendarResource[] = [];
  resources.forEach((resource) => {
    if (!resource) return;
    if (seen.has(resource.id)) return;
    seen.add(resource.id);
    output.push(resource);
  });
  return output;
}

function sanitizeVariantProduct(input: any): CalendarVariantProduct | null {
  const id = toTrimmed(input?.id);
  if (!id) return null;
  return {
    id,
    id_woo: toOptionalString(input?.id_woo),
    name: toOptionalString(input?.name),
    code: toOptionalString(input?.code),
    category: toOptionalString(input?.category),
    hora_inicio: toOptionalString(input?.hora_inicio),
    hora_fin: toOptionalString(input?.hora_fin),
    default_variant_start: toOptionalString(input?.default_variant_start),
    default_variant_end: toOptionalString(input?.default_variant_end),
    default_variant_stock_status: toOptionalString(input?.default_variant_stock_status),
    default_variant_stock_quantity:
      typeof input?.default_variant_stock_quantity === 'number'
        ? input.default_variant_stock_quantity
        : input?.default_variant_stock_quantity != null && !Number.isNaN(Number(input.default_variant_stock_quantity))
          ? Number(input.default_variant_stock_quantity)
          : null,
    default_variant_price: toOptionalString(input?.default_variant_price),
  } satisfies CalendarVariantProduct;
}

function sanitizeVariantDetails(input: any): CalendarVariantDetails | null {
  const id = toTrimmed(input?.id);
  if (!id) return null;
  const trainerId = toOptionalString(input?.trainer_id);
  const salaId = toOptionalString(input?.sala_id);
  const unidadId = toOptionalString(input?.unidad_movil_id);
  return {
    id,
    id_woo: toOptionalString(input?.id_woo),
    name: toOptionalString(input?.name),
    status: toOptionalString(input?.status),
    price: toOptionalString(input?.price),
    stock:
      typeof input?.stock === 'number'
        ? input.stock
        : input?.stock != null && !Number.isNaN(Number(input.stock))
          ? Number(input.stock)
          : null,
    stock_status: toOptionalString(input?.stock_status),
    sede: toOptionalString(input?.sede),
    date: toOptionalString(input?.date),
    trainer_id: trainerId,
    trainer:
      input?.trainer && typeof input.trainer === 'object'
        ? {
            trainer_id: toOptionalString(input.trainer?.trainer_id) ?? trainerId,
            name: toOptionalString(input.trainer?.name),
            apellido: toOptionalString(input.trainer?.apellido),
          }
        : null,
    sala_id: salaId,
    sala:
      input?.sala && typeof input.sala === 'object'
        ? {
            sala_id: toOptionalString(input.sala?.sala_id) ?? salaId,
            name: toOptionalString(input.sala?.name),
            sede: toOptionalString(input.sala?.sede),
          }
        : null,
    unidad_movil_id: unidadId,
    unidad:
      input?.unidad && typeof input.unidad === 'object'
        ? {
            unidad_id: toOptionalString(input.unidad?.unidad_id) ?? unidadId,
            name: toOptionalString(input.unidad?.name),
            matricula: toOptionalString(input.unidad?.matricula),
          }
        : null,
    students_total:
      typeof input?.students_total === 'number'
        ? input.students_total
        : input?.students_total != null && !Number.isNaN(Number(input.students_total))
          ? Number(input.students_total)
          : null,
    created_at: toOptionalString(input?.created_at),
    updated_at: toOptionalString(input?.updated_at),
  } satisfies CalendarVariantDetails;
}

function sanitizeVariantsPayload(payload: any[]): CalendarVariantEvent[] {
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((row) => {
      const id = toTrimmed(row?.id);
      const start = toTrimmed(row?.start);
      const end = toTrimmed(row?.end);
      if (!id || !start || !end) return null;

      const product = sanitizeVariantProduct(row?.product);
      const variant = sanitizeVariantDetails(row?.variant);
      if (!product || !variant) return null;

      return {
        id,
        start,
        end,
        product,
        variant,
      } satisfies CalendarVariantEvent;
    })
    .filter((variant): variant is CalendarVariantEvent => variant !== null);
}

function sanitizeSessionsPayload(payload: any[]): CalendarSession[] {
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((row) => {
      const id = toTrimmed(row?.id);
      const start = toTrimmed(row?.fecha_inicio_utc);
      const end = toTrimmed(row?.fecha_fin_utc);
      const title = toTrimmed(row?.nombre_cache) ?? 'Sesión';
      if (!id || !start || !end) return null;

      const room = row?.sala ? toResource({ ...row.sala, id: row.sala.sala_id }) : null;
      const trainers = ensureUniqueResources(
        Array.isArray(row?.trainers)
          ? row.trainers.map((trainer: any) =>
              toResource({
                id: trainer?.trainer_id,
                name: trainer?.name,
                secondary: trainer?.apellido,
              }),
            )
          : [],
      );

      const units = ensureUniqueResources(
        Array.isArray(row?.unidades)
          ? row.unidades.map((unit: any) =>
              toResource({
                id: unit?.unidad_id,
                name: unit?.name,
                secondary: unit?.matricula,
              }),
            )
          : [],
      );

      return {
        id,
        dealId: toTrimmed(row?.deal_id) ?? '',
        dealTitle: toOptionalString(row?.deal_title),
        dealAddress: toOptionalString(row?.deal_training_address),
        dealPipelineId: toOptionalString(row?.deal_pipeline_id),
        productId: toTrimmed(row?.deal_product_id) ?? '',
        productName: toOptionalString(row?.product_name),
        productCode: toOptionalString(row?.product_code),
        title,
        start,
        end,
        estado: toSessionEstado(row?.estado),
        direccion: toOptionalString(row?.direccion),
        comentarios: toOptionalString(row?.comentarios),
        room,
        trainers,
        units,
      } satisfies CalendarSession;
    })
    .filter((session): session is CalendarSession => session !== null);
}

function buildQuery(params: CalendarSessionsParams): string {
  const search = new URLSearchParams();
  search.set('start', params.start);
  search.set('end', params.end);
  if (params.dealId) search.set('dealId', params.dealId);
  if (params.productId) search.set('productId', params.productId);
  if (params.roomId) search.set('roomId', params.roomId);
  if (params.trainerId) search.set('trainerId', params.trainerId);
  if (params.unitId) search.set('unitId', params.unitId);
  if (params.estados?.length) search.set('estado', params.estados.join(','));
  return search.toString();
}

export async function fetchCalendarSessions(
  params: CalendarSessionsParams,
): Promise<CalendarSessionsResponse> {
  const query = buildQuery(params);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/sessions/range?${query}`);
  } catch (error: any) {
    throw new ApiError('NETWORK_ERROR', error?.message ?? 'Fallo de red');
  }

  let payload: any = {};
  try {
    payload = await response.json();
  } catch {
    /* cuerpo vacío */
  }

  if (!response.ok || payload?.ok === false) {
    const code = payload?.error_code ?? payload?.code ?? `HTTP_${response.status}`;
    const message = payload?.message ?? 'Error inesperado en la carga del calendario';
    throw new ApiError(code, message, response.status);
  }

  const rangeStart = toTrimmed(payload?.range?.start);
  const rangeEnd = toTrimmed(payload?.range?.end);
  const sessions = sanitizeSessionsPayload(payload?.sessions);

  return {
    range: {
      start: rangeStart ?? params.start,
      end: rangeEnd ?? params.end,
    },
    sessions,
  };
}

export async function fetchCalendarVariants(
  params: CalendarVariantsParams,
): Promise<CalendarVariantsResponse> {
  const search = new URLSearchParams();
  search.set('start', params.start);
  search.set('end', params.end);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/calendar-variants?${search.toString()}`);
  } catch (error: any) {
    throw new ApiError('NETWORK_ERROR', error?.message ?? 'Fallo de red');
  }

  let payload: any = {};
  try {
    payload = await response.json();
  } catch {
    /* cuerpo vacío */
  }

  if (!response.ok || payload?.ok === false) {
    const code = payload?.error_code ?? payload?.code ?? `HTTP_${response.status}`;
    const message = payload?.message ?? 'Error inesperado en la carga del calendario';
    throw new ApiError(code, message, response.status);
  }

  const rangeStart = toTrimmed(payload?.range?.start);
  const rangeEnd = toTrimmed(payload?.range?.end);
  const variants = sanitizeVariantsPayload(payload?.variants);

  return {
    range: {
      start: rangeStart ?? params.start,
      end: rangeEnd ?? params.end,
    },
    variants,
  } satisfies CalendarVariantsResponse;
}
