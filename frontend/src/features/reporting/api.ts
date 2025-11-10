import { getJson } from '../../api/client';

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

export type TrainerHoursItem = {
  trainerId: string;
  name: string | null;
  lastName: string | null;
  sessionCount: number;
  totalHours: number;
};

export type TrainerHoursResponse = {
  items: TrainerHoursItem[];
  summary: {
    totalSessions: number;
    totalHours: number;
  };
};

export type TrainerHoursFilters = {
  startDate?: string;
  endDate?: string;
};

export async function fetchTrainerHours(filters: TrainerHoursFilters = {}): Promise<TrainerHoursResponse> {
  const params = new URLSearchParams();
  if (filters.startDate) {
    params.set('startDate', filters.startDate);
  }
  if (filters.endDate) {
    params.set('endDate', filters.endDate);
  }

  const query = params.toString();
  const url = query.length ? `/reporting-horas-formadores?${query}` : '/reporting-horas-formadores';
  return getJson<TrainerHoursResponse>(url);
}

export type ControlHorarioRecord = {
  id: string;
  sessionName: string | null;
  organizationName: string | null;
  trainerFullName: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  clockIn: string | null;
  clockOut: string | null;
};

function sanitizeControlHorarioRecord(entry: unknown): ControlHorarioRecord | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const raw = entry as Record<string, unknown>;
  const id = sanitizeText(raw.id);
  const trainerFullName =
    sanitizeText(raw.trainerFullName ?? raw.trainer_full_name) ??
    sanitizeText(raw.trainerName ?? raw.trainer_name) ??
    sanitizeText(raw.trainerId ?? raw.trainer_id);

  if (!id || !trainerFullName) {
    return null;
  }

  return {
    id,
    sessionName: sanitizeText(raw.sessionName ?? raw.session_name),
    organizationName: sanitizeText(raw.organizationName ?? raw.organization_name),
    trainerFullName,
    plannedStart: sanitizeDate(raw.plannedStart ?? raw.planned_start),
    plannedEnd: sanitizeDate(raw.plannedEnd ?? raw.planned_end),
    clockIn: sanitizeDate(raw.clockIn ?? raw.clock_in),
    clockOut: sanitizeDate(raw.clockOut ?? raw.clock_out),
  } satisfies ControlHorarioRecord;
}

export async function fetchControlHorarioRecords(): Promise<ControlHorarioRecord[]> {
  const data = await getJson<{ records?: unknown }>(`/reporting-control-horario`);
  const entries = Array.isArray(data?.records) ? data.records : [];
  return entries
    .map(sanitizeControlHorarioRecord)
    .filter((record): record is ControlHorarioRecord => record !== null);
}
