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

export type ControlHorarioAbsence = {
  date: string;
  type: string;
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
  absences: ControlHorarioAbsence[];
  contractHoursByMonth: Record<string, number | null>;
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


function sanitizeOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.length) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sanitizeAbsence(entry: unknown): ControlHorarioAbsence | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const raw = entry as Record<string, unknown>;
  const date = sanitizeText(raw.date);
  const type = sanitizeText(raw.type);
  if (!date || !type) return null;
  return { date, type };
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
  const data = await getJson<{
    user?: ControlHorarioResponse['user'];
    range?: ControlHorarioResponse['range'];
    entries?: unknown;
    absences?: unknown;
    contractHoursByMonth?: unknown;
    meta?: ControlHorarioResponse['meta'];
  }>(url);
  const entries = Array.isArray(data?.entries)
    ? data.entries.map(sanitizeEntry).filter((entry): entry is ControlHorarioEntry => entry !== null)
    : [];
  const absences = Array.isArray(data?.absences)
    ? data.absences.map(sanitizeAbsence).filter((absence): absence is ControlHorarioAbsence => absence !== null)
    : [];

  const contractHoursByMonthRaw = data?.contractHoursByMonth;
  const contractHoursByMonth =
    contractHoursByMonthRaw && typeof contractHoursByMonthRaw === 'object'
      ? Object.entries(contractHoursByMonthRaw as Record<string, unknown>).reduce<Record<string, number | null>>(
          (acc, [key, value]) => {
            acc[key] = sanitizeOptionalNumber(value);
            return acc;
          },
          {},
        )
      : {};

  return {
    user: data?.user ?? { id: '', name: '', role: '' },
    range: data?.range ?? { start: '', end: '' },
    meta: data?.meta ?? { yesterday: '' },
    entries,
    absences,
    contractHoursByMonth,
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
