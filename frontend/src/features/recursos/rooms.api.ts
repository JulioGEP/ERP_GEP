// frontend/src/features/recursos/rooms.api.ts
import { API_BASE, ApiError } from '../../api/client';
import type { Room } from '../../types/room';
import { SEDE_OPTIONS } from './trainers.constants';

export type RoomPayload = {
  sala_id?: string | null;
  name?: string | null;
  sede?: string | null;
};

type RoomListResponse = {
  ok: boolean;
  rooms?: unknown;
  message?: string;
  error_code?: string;
};

type RoomMutationResponse = {
  ok: boolean;
  room?: unknown;
  message?: string;
  error_code?: string;
};

function parseJson(text: string): any {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ApiError('INVALID_RESPONSE', 'Respuesta JSON inválida del servidor');
  }
}

function normalizeRoom(row: any): Room {
  if (!row || typeof row !== 'object') {
    throw new ApiError('INVALID_RESPONSE', 'Formato de sala no válido');
  }

  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at ?? null;
  const updatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ?? null;

  return {
    sala_id: String(row.sala_id ?? row.id ?? ''),
    name: String(row.name ?? ''),
    sede: typeof row.sede === 'string' ? row.sede : null,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function toNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

function buildRequestBody(payload: RoomPayload): Record<string, any> {
  const body: Record<string, any> = {};

  if ('sala_id' in payload) {
    const value = toNullableString(payload.sala_id);
    if (value) body.sala_id = value;
  }

  if ('name' in payload) {
    const value = toNullableString(payload.name);
    body.name = value;
  }

  if ('sede' in payload) {
    const raw = toNullableString(payload.sede);
    if (!raw) {
      body.sede = raw;
    } else if (SEDE_OPTIONS.includes(raw as (typeof SEDE_OPTIONS)[number])) {
      body.sede = raw;
    } else {
      throw new ApiError('VALIDATION_ERROR', 'Valor de sede no válido');
    }
  }

  return body;
}

async function requestJson(input: RequestInfo, init?: RequestInit) {
  const finalInit: RequestInit = {
    ...init,
    credentials: init?.credentials ?? 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-ERP-Client': 'frontend',
      ...(init?.headers || {}),
    },
  };

  const response = await fetch(input, finalInit);
  const text = await response.text();
  const json = parseJson(text);

  if (!response.ok || json?.ok === false) {
    const code = json?.error_code ?? `HTTP_${response.status}`;
    const message = json?.message ?? 'Error inesperado en la solicitud';
    throw new ApiError(code, message, response.status);
  }

  return json;
}

export async function fetchRooms(params: { search?: string } = {}): Promise<Room[]> {
  const search = typeof params.search === 'string' ? params.search.trim() : '';
  const query = search ? `?${new URLSearchParams({ search }).toString()}` : '';
  const json = (await requestJson(`${API_BASE}/rooms${query}`)) as RoomListResponse;
  const rows = Array.isArray(json.rooms) ? json.rooms : [];
  return rows.map((row) => normalizeRoom(row));
}

export async function createRoom(payload: RoomPayload): Promise<Room> {
  const body = buildRequestBody(payload);
  const json = (await requestJson(`${API_BASE}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })) as RoomMutationResponse;

  return normalizeRoom(json.room);
}

export async function updateRoom(roomId: string, payload: RoomPayload): Promise<Room> {
  if (!roomId) {
    throw new ApiError('VALIDATION_ERROR', 'sala_id requerido para actualizar');
  }

  const body = buildRequestBody(payload);
  const json = (await requestJson(`${API_BASE}/rooms/${encodeURIComponent(roomId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })) as RoomMutationResponse;

  return normalizeRoom(json.room);
}
