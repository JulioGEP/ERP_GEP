// frontend/src/features/recursos/api.ts
import { API_BASE, ApiError } from "../../api/client";
import type { Trainer } from "../../types/trainer";
import { SEDE_OPTIONS } from "./trainers.constants";

export type TrainerPayload = {
  trainer_id?: string | null;
  name?: string | null;
  apellido?: string | null;
  email?: string | null;
  phone?: string | null;
  dni?: string | null;
  direccion?: string | null;
  especialidad?: string | null;
  titulacion?: string | null;
  activo?: boolean | null;
  sede?: string[] | null;
};

type TrainerListResponse = {
  ok: boolean;
  trainers?: unknown;
  message?: string;
  error_code?: string;
};

type TrainerMutationResponse = {
  ok: boolean;
  trainer?: unknown;
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

function normalizeTrainer(row: any): Trainer {
  if (!row || typeof row !== "object") {
    throw new ApiError("INVALID_RESPONSE", "Formato de formador no válido");
  }

  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at ?? null;
  const updatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ?? null;

  return {
    trainer_id: String(row.trainer_id ?? row.id ?? ""),
    name: String(row.name ?? ""),
    apellido: row.apellido ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    dni: row.dni ?? null,
    direccion: row.direccion ?? null,
    especialidad: row.especialidad ?? null,
    titulacion: row.titulacion ?? null,
    activo: Boolean(row.activo ?? false),
    sede: Array.isArray(row.sede)
      ? row.sede.filter((value: unknown): value is string => typeof value === "string")
      : [],
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function toNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

function buildRequestBody(payload: TrainerPayload): Record<string, any> {
  const body: Record<string, any> = {};

  if ("trainer_id" in payload) {
    const value = toNullableString(payload.trainer_id);
    if (value) body.trainer_id = value;
  }

  if ("name" in payload) {
    const value = toNullableString(payload.name);
    body.name = value;
  }

  const fields: Array<keyof TrainerPayload> = [
    "apellido",
    "email",
    "phone",
    "dni",
    "direccion",
    "especialidad",
    "titulacion",
  ];

  for (const field of fields) {
    if (field in payload) {
      body[field] = toNullableString(payload[field as keyof TrainerPayload]);
    }
  }

  if ("activo" in payload) {
    body.activo = Boolean(payload.activo);
  }

  if ("sede" in payload) {
    const rawValues = Array.isArray(payload.sede) ? payload.sede : [];
    const values: string[] = [];
    for (const raw of rawValues) {
      const value = typeof raw === "string" ? raw.trim() : "";
      if (!value.length) continue;
      if (!SEDE_OPTIONS.includes(value as (typeof SEDE_OPTIONS)[number])) continue;
      if (!values.includes(value)) {
        values.push(value);
      }
    }
    body.sede = values;
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

export async function fetchTrainers(): Promise<Trainer[]> {
  const json = (await requestJson(`${API_BASE}/trainers`)) as TrainerListResponse;
  const rows = Array.isArray(json.trainers) ? json.trainers : [];
  return rows.map((row) => normalizeTrainer(row));
}

export async function createTrainer(payload: TrainerPayload): Promise<Trainer> {
  const body = buildRequestBody(payload);
  const json = (await requestJson(`${API_BASE}/trainers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })) as TrainerMutationResponse;

  return normalizeTrainer(json.trainer);
}

export async function updateTrainer(trainerId: string, payload: TrainerPayload): Promise<Trainer> {
  if (!trainerId) {
    throw new ApiError("VALIDATION_ERROR", "trainer_id requerido para actualizar");
  }

  const body = buildRequestBody(payload);
  const json = (await requestJson(`${API_BASE}/trainers/${encodeURIComponent(trainerId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })) as TrainerMutationResponse;

  return normalizeTrainer(json.trainer);
}
