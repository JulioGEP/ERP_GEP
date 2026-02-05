// frontend/src/api/client.ts

// Determina la base de funciones Netlify en local/prod
export const API_BASE =
  typeof window !== 'undefined' && window.location
    ? window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? window.location.port === '8888'
        ? '/.netlify/functions'
        : 'http://localhost:8888/.netlify/functions'
      : '/.netlify/functions'
    : '/.netlify/functions';

export class ApiError extends Error {
  code: string;
  status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError ||
    (typeof error === 'object' && error !== null && (error as any).name === 'ApiError')
  );
}

export type RequestJsonOptions = {
  defaultErrorMessage?: string;
  defaultErrorCode?: string;
  networkErrorMessage?: string;
  invalidResponseMessage?: string;
  parseJson?: (text: string) => any;
};

function resolveRequestInput(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input === 'string') {
    if (/^https?:/i.test(input)) return input;
    const path = input.startsWith('/') ? input : `/${input}`;
    return `${API_BASE}${path}`;
  }
  return input;
}

export const SESSION_EXPIRED_EVENT = 'erp:session-expired';

function notifySessionExpired() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

/**
 * requestJson: hace fetch JSON con credenciales incluidas por defecto.
 * - Fuerza 'include' en credentials para enviar/recibir cookie HttpOnly (erp_session).
 * - Lanza ApiError con code y status cuando no es ok.
 */
export async function requestJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: RequestJsonOptions,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(resolveRequestInput(input), {
      ...init,
      credentials: init?.credentials ?? 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-ERP-Client': 'frontend',
        ...(init?.headers || {}),
      },
    });
  } catch (_err) {
    const message = options?.networkErrorMessage ?? 'No se pudo conectar con el servidor.';
    throw new ApiError('NETWORK_ERROR', message, undefined);
  }

  let raw = '';
  try {
    raw = await response.text();
  } catch {
    raw = '';
  }

  let json: any = {};
  if (raw) {
    try {
      json = options?.parseJson ? options.parseJson(raw) : JSON.parse(raw);
    } catch {
      const preview = raw.trim().slice(0, 500);
      const details = preview ? ` Detalle: ${preview}` : '';
      const message = `${options?.invalidResponseMessage ?? 'Respuesta JSON inválida del servidor.'}${details}`;
      throw new ApiError('INVALID_RESPONSE', message, response.status || undefined);
    }
  }

  // Consideramos error si HTTP !ok o payload ok === false
  if (!response.ok || (json && typeof json === 'object' && json.ok === false)) {
    const message = json?.message ?? options?.defaultErrorMessage ?? 'No se pudo completar la solicitud.';
    const code = json?.error_code ?? options?.defaultErrorCode ?? `HTTP_${response.status}`;
    if (response.status === 401) {
      notifySessionExpired();
    }
    throw new ApiError(code, message, response.status || undefined);
  }

  return (json ?? {}) as T;
}

/* ------------------------- Helpers de conveniencia ------------------------- */

export function isUnauthorized(err: unknown): boolean {
  return isApiError(err) && (err.status === 401 || err.code === 'HTTP_401');
}

export async function getJson<T = any>(path: string, init?: RequestInit) {
  return requestJson<T>(path, { ...(init || {}), method: 'GET' });
}

export async function postJson<T = any>(path: string, body?: any, init?: RequestInit) {
  return requestJson<T>(path, {
    ...(init || {}),
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function putJson<T = any>(path: string, body?: any, init?: RequestInit) {
  return requestJson<T>(path, {
    ...(init || {}),
    method: 'PUT',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function patchJson<T = any>(path: string, body?: any, init?: RequestInit) {
  return requestJson<T>(path, {
    ...(init || {}),
    method: 'PATCH',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function delJson<T = any>(path: string, body?: any, init?: RequestInit) {
  return requestJson<T>(path, {
    ...(init || {}),
    method: 'DELETE',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/* ------------------------- Utilidades varias (immutables) ------------------ */

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isNaN(parsed) ? null : parsed;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function toNonNegativeInteger(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

export function toStringValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (entry === null || entry === undefined) continue;
    const text = String(entry).trim();
    if (!text.length) continue;
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

export function pickNonEmptyString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length) return trimmed;
    }
  }
  return null;
}

export function sanitizeStringArray(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  const normalized = values
    .map((value) => String(value ?? '').trim())
    .filter((value) => value.length);
  return Array.from(new Set(normalized));
}

export function normalizeDriveUrlInput(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value ?? '').trim();
  return text.length ? text : null;
}
