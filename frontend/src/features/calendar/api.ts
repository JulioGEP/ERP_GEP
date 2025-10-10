// frontend/src/features/calendar/api.ts
import { API_BASE, ApiError, type SessionEstado } from '../presupuestos/api';

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
