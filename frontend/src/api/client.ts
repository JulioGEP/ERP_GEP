import { Buffer } from 'buffer';

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

export function isApiError(err: unknown): err is ApiError {
  return (
    err instanceof ApiError ||
    (typeof err === 'object' && !!err && (err as { name?: string }).name === 'ApiError')
  );
}

type JsonLike = Record<string, any> | { ok?: boolean } | null;

type RequestInput = RequestInfo | URL | string;

function resolveUrl(input: RequestInput): RequestInfo | URL {
  if (typeof input !== 'string') {
    return input;
  }

  if (/^https?:\/\//i.test(input) || input.startsWith('/.netlify/')) {
    return input;
  }

  const normalized = input.startsWith('/') ? input : `/${input}`;
  return `${API_BASE}${normalized}`;
}

export async function requestJson<T = JsonLike>(input: RequestInput, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(resolveUrl(input), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fallo de red';
    throw new ApiError('NETWORK_ERROR', message);
  }

  let text = '';

  try {
    text = await response.text();
  } catch (error) {
    if (error instanceof Error) {
      throw new ApiError('INVALID_RESPONSE', error.message, response.status || undefined);
    }
    throw new ApiError('INVALID_RESPONSE', 'No se pudo leer la respuesta', response.status || undefined);
  }

  let data: JsonLike;

  if (!text) {
    data = null;
  } else {
    try {
      data = JSON.parse(text) as JsonLike;
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Respuesta JSON inválida del servidor';
      throw new ApiError('INVALID_RESPONSE', message, response.status || undefined);
    }
  }

  const isError = !response.ok || (data && typeof data === 'object' && 'ok' in data && data.ok === false);

  if (isError) {
    const body = data && typeof data === 'object' ? (data as Record<string, any>) : {};
    const code = body.error_code || body.code || `HTTP_${response.status}`;
    const message = typeof body.message === 'string' && body.message.length
      ? body.message
      : response.statusText || 'Error inesperado';
    throw new ApiError(code, message, response.status || undefined);
  }

  return (data as T) ?? ({} as T);
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

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  if (typeof btoa === 'function') {
    return btoa(binary);
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(binary, 'binary').toString('base64');
  }

  throw new Error('No se puede convertir el archivo a base64 en este entorno.');
}
