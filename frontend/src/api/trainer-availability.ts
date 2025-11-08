// frontend/src/api/trainer-availability.ts
import { getJson, putJson } from './client';

export type TrainerAvailabilityOverride = {
  date: string;
  available: boolean;
};

export type TrainerAvailabilityResponse = {
  year: number;
  overrides: TrainerAvailabilityOverride[];
};

function sanitizeDateString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function sanitizeOverride(entry: unknown): TrainerAvailabilityOverride | null {
  if (!entry || typeof entry !== 'object') return null;
  const raw = entry as { date?: unknown; available?: unknown };
  const date = sanitizeDateString(raw.date);
  if (!date) return null;
  return { date, available: Boolean(raw.available) };
}

function parseAvailabilityPayload(raw: any, fallbackYear: number | null): TrainerAvailabilityResponse {
  const rawYear = Number.parseInt(String(raw?.year ?? ''), 10);
  const year = Number.isFinite(rawYear) ? rawYear : fallbackYear ?? new Date().getFullYear();

  const overridesRaw = Array.isArray(raw?.overrides) ? raw.overrides : [];
  const overrideMap = new Map<string, boolean>();

  for (const entry of overridesRaw) {
    const normalized = sanitizeOverride(entry);
    if (!normalized) continue;
    overrideMap.set(normalized.date, normalized.available);
  }

  const overrides = Array.from(overrideMap.entries())
    .map(([date, available]) => ({ date, available }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { year, overrides };
}

export async function fetchTrainerAvailability(params?: { year?: number }): Promise<TrainerAvailabilityResponse> {
  const searchParams = new URLSearchParams();
  if (params?.year) {
    searchParams.set('year', String(params.year));
  }

  const query = searchParams.toString();
  const response = await getJson<any>(query.length ? `/trainer-availability?${query}` : '/trainer-availability');
  return parseAvailabilityPayload(response?.availability ?? response, params?.year ?? null);
}

export async function updateTrainerAvailability(updates: TrainerAvailabilityOverride[]): Promise<TrainerAvailabilityResponse> {
  if (!updates.length) {
    return fetchTrainerAvailability();
  }

  const normalizedUpdates = new Map<string, TrainerAvailabilityOverride>();
  let year: number | null = null;

  for (const update of updates) {
    const sanitized = sanitizeOverride(update);
    if (!sanitized) continue;
    const [yearText] = sanitized.date.split('-');
    const parsedYear = Number.parseInt(yearText, 10);
    if (Number.isFinite(parsedYear)) {
      year = parsedYear;
    }
    normalizedUpdates.set(sanitized.date, sanitized);
  }

  if (!normalizedUpdates.size) {
    return fetchTrainerAvailability(year ? { year } : undefined);
  }

  const payload = Array.from(normalizedUpdates.values());
  const response = await putJson<any>('/trainer-availability', { updates: payload });
  return parseAvailabilityPayload(response?.availability ?? response, year);
}
