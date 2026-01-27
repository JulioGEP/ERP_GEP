import { getJson, postJson, putJson } from '../../api/client';

function sanitizeText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function sanitizeDate(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.length) {
    return null;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return trimmed;
}

export type ControlHorarioEntry = {
  id: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
};

export type ControlHorarioResponse = {
  user: {
    id: string;
    name: string;
    role: string;
  };
  range: {
    start: string;
    end: string;
  };
  entries: ControlHorarioEntry[];
  meta: {
    yesterday: string;
  };
};

function sanitizeEntry(entry: unknown): ControlHorarioEntry | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const raw = entry as Record<string, unknown>;
  const id = sanitizeText(raw.id);
  const date = sanitizeText(raw.date);
  if (!id || !date) return null;
  return {
    id,
    date,
    checkIn: sanitizeDate(raw.checkIn ?? raw.check_in),
    checkOut: sanitizeDate(raw.checkOut ?? raw.check_out),
  };
}

export type ControlHorarioFilters = {
  startDate?: string;
  endDate?: string;
};

export async function fetchControlHorario(
  filters: ControlHorarioFilters = {},
): Promise<ControlHorarioResponse> {
  const params = new URLSearchParams();
  if (filters.startDate) {
    params.set('startDate', filters.startDate);
  }
  if (filters.endDate) {
    params.set('endDate', filters.endDate);
  }
  const query = params.toString();
  const url = query.length ? `/control-horario?${query}` : '/control-horario';
  const data = await getJson<ControlHorarioResponse>(url);
  const entries = Array.isArray(data?.entries)
    ? data.entries.map(sanitizeEntry).filter((entry): entry is ControlHorarioEntry => entry !== null)
    : [];
  return {
    user: data.user,
    range: data.range,
    meta: data.meta,
    entries,
  };
}

export async function clockInControlHorario(): Promise<ControlHorarioEntry> {
  const data = await postJson<{ entry?: unknown }>(`/control-horario-clock-in`);
  const entry = sanitizeEntry(data?.entry);
  if (!entry) {
    throw new Error('Respuesta inválida del servidor.');
  }
  return entry;
}

export async function clockOutControlHorario(): Promise<ControlHorarioEntry> {
  const data = await postJson<{ entry?: unknown }>(`/control-horario-clock-out`);
  const entry = sanitizeEntry(data?.entry);
  if (!entry) {
    throw new Error('Respuesta inválida del servidor.');
  }
  return entry;
}

export type ControlHorarioEntryPayload = {
  id?: string;
  date?: string;
  checkInTime: string;
  checkOutTime?: string | null;
};

export async function createControlHorarioEntry(
  payload: ControlHorarioEntryPayload,
): Promise<ControlHorarioEntry> {
  const data = await postJson<{ entry?: unknown }>(`/control-horario-entry`, payload);
  const entry = sanitizeEntry(data?.entry);
  if (!entry) {
    throw new Error('Respuesta inválida del servidor.');
  }
  return entry;
}

export async function updateControlHorarioEntry(
  payload: ControlHorarioEntryPayload,
): Promise<ControlHorarioEntry> {
  const data = await putJson<{ entry?: unknown }>(`/control-horario-entry`, payload);
  const entry = sanitizeEntry(data?.entry);
  if (!entry) {
    throw new Error('Respuesta inválida del servidor.');
  }
  return entry;
}
