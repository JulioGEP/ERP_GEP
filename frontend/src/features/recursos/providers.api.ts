// frontend/src/features/recursos/providers.api.ts
import { API_BASE, ApiError } from '../../api/client';
import type { Provider } from '../../types/provider';

export type ProviderPayload = {
  nombre_fiscal?: string | null;
  direccion_fiscal?: string | null;
  telefono_fiscal?: string | null;
  mail_empresa?: string | null;
  persona_contacto?: string | null;
  telefono_contacto?: string | null;
  mail_contacto?: string | null;
};

type ProviderListResponse = {
  ok: boolean;
  providers?: unknown;
  message?: string;
  error_code?: string;
};

type ProviderMutationResponse = {
  ok: boolean;
  provider?: unknown;
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

function toNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

function normalizeProvider(row: any): Provider {
  if (!row || typeof row !== 'object') {
    throw new ApiError('INVALID_RESPONSE', 'Formato de proveedor no válido');
  }

  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at ?? null;
  const updatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ?? null;

  const providerId = row.provider_id ?? row.id ?? row.proveedor_id ?? null;
  if (!providerId) {
    throw new ApiError('INVALID_RESPONSE', 'provider_id no encontrado en la respuesta');
  }

  return {
    provider_id: String(providerId),
    nombre_fiscal: String(row.nombre_fiscal ?? ''),
    direccion_fiscal: row.direccion_fiscal ? String(row.direccion_fiscal) : null,
    telefono_fiscal: row.telefono_fiscal ? String(row.telefono_fiscal) : null,
    mail_empresa: row.mail_empresa ? String(row.mail_empresa) : null,
    persona_contacto: row.persona_contacto ? String(row.persona_contacto) : null,
    telefono_contacto: row.telefono_contacto ? String(row.telefono_contacto) : null,
    mail_contacto: row.mail_contacto ? String(row.mail_contacto) : null,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function buildRequestBody(payload: ProviderPayload): Record<string, any> {
  const body: Record<string, any> = {};

  if ('nombre_fiscal' in payload) {
    const value = toNullableString(payload.nombre_fiscal);
    if (value === null) throw new ApiError('VALIDATION_ERROR', 'El nombre fiscal es obligatorio');
    body.nombre_fiscal = value;
  }

  if ('direccion_fiscal' in payload) {
    body.direccion_fiscal = toNullableString(payload.direccion_fiscal);
  }

  if ('telefono_fiscal' in payload) {
    body.telefono_fiscal = toNullableString(payload.telefono_fiscal);
  }

  if ('mail_empresa' in payload) {
    body.mail_empresa = toNullableString(payload.mail_empresa);
  }

  if ('persona_contacto' in payload) {
    body.persona_contacto = toNullableString(payload.persona_contacto);
  }

  if ('telefono_contacto' in payload) {
    body.telefono_contacto = toNullableString(payload.telefono_contacto);
  }

  if ('mail_contacto' in payload) {
    body.mail_contacto = toNullableString(payload.mail_contacto);
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

export async function fetchProviders(): Promise<Provider[]> {
  const json = (await requestJson(`${API_BASE}/providers`)) as ProviderListResponse;
  const rows = Array.isArray(json.providers) ? json.providers : [];
  return rows.map((row) => normalizeProvider(row));
}

export async function updateProvider(providerId: string, payload: ProviderPayload): Promise<Provider> {
  if (!providerId) {
    throw new ApiError('VALIDATION_ERROR', 'provider_id requerido para actualizar');
  }

  const body = buildRequestBody(payload);
  const json = (await requestJson(`${API_BASE}/providers/${encodeURIComponent(providerId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })) as ProviderMutationResponse;

  return normalizeProvider(json.provider);
}
