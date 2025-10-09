// frontend/src/features/recursos/mobileUnits.api.ts
import { API_BASE, ApiError } from "../presupuestos/api";
import type { MobileUnit } from "../../types/mobile-unit";

export type MobileUnitPayload = {
  unidad_id?: string | null;
  name?: string | null;
  matricula?: string | null;
  tipo?: string | null;
  sede?: string | null;
};

type MobileUnitListResponse = {
  ok: boolean;
  mobileUnits?: unknown;
  message?: string;
  error_code?: string;
};

type MobileUnitMutationResponse = {
  ok: boolean;
  mobileUnit?: unknown;
  message?: string;
  error_code?: string;
};

function parseJson(text: string): any {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ApiError("INVALID_RESPONSE", "Respuesta JSON inválida del servidor");
  }
}

function normalizeMobileUnit(row: any): MobileUnit {
  if (!row || typeof row !== "object") {
    throw new ApiError("INVALID_RESPONSE", "Formato de unidad móvil no válido");
  }

  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at ?? null;
  const updatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ?? null;

  return {
    unidad_id: String(row.unidad_id ?? row.id ?? ""),
    name: String(row.name ?? ""),
    matricula: String(row.matricula ?? ""),
    tipo: String(row.tipo ?? ""),
    sede: String(row.sede ?? ""),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function toNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

function buildRequestBody(payload: MobileUnitPayload): Record<string, any> {
  const body: Record<string, any> = {};

  if ("unidad_id" in payload) {
    const value = toNullableString(payload.unidad_id);
    if (value) body.unidad_id = value;
  }

  const fields: Array<keyof MobileUnitPayload> = ["name", "matricula", "tipo", "sede"];

  for (const field of fields) {
    if (field in payload) {
      body[field] = toNullableString(payload[field]);
    }
  }

  return body;
}

async function requestJson(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, init);
  const text = await response.text();
  const json = parseJson(text);

  if (!response.ok || json?.ok === false) {
    const code = json?.error_code ?? `HTTP_${response.status}`;
    const message = json?.message ?? "Error inesperado en la solicitud";
    throw new ApiError(code, message, response.status);
  }

  return json;
}

export async function fetchMobileUnits(): Promise<MobileUnit[]> {
  const json = (await requestJson(`${API_BASE}/mobile-units`)) as MobileUnitListResponse;
  const rows = Array.isArray(json.mobileUnits) ? json.mobileUnits : [];
  return rows.map((row) => normalizeMobileUnit(row));
}

export async function createMobileUnit(payload: MobileUnitPayload): Promise<MobileUnit> {
  const body = buildRequestBody(payload);
  const json = (await requestJson(`${API_BASE}/mobile-units`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })) as MobileUnitMutationResponse;

  return normalizeMobileUnit(json.mobileUnit);
}

export async function updateMobileUnit(unidadId: string, payload: MobileUnitPayload): Promise<MobileUnit> {
  if (!unidadId) {
    throw new ApiError("VALIDATION_ERROR", "unidad_id requerido para actualizar");
  }

  const body = buildRequestBody(payload);
  const json = (await requestJson(`${API_BASE}/mobile-units/${encodeURIComponent(unidadId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })) as MobileUnitMutationResponse;

  return normalizeMobileUnit(json.mobileUnit);
}
