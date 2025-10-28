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

type RequestTarget = RequestInfo | URL;

function resolveRequestTargets(input: RequestInfo | URL): RequestTarget[] {
  if (typeof input !== 'string') {
    return [input];
  }

  if (/^https?:/i.test(input)) {
    return [input];
  }

  const path = input.startsWith('/') ? input : `/${input}`;
  const targets: string[] = [`${API_BASE}${path}`];

  if (API_BASE.includes('/.netlify/functions')) {
    const fallback = buildNetlifyFallbackPath(path);
    if (fallback && fallback !== path) {
      targets.push(`${API_BASE}${fallback}`);
    }
  }

  return targets;
}

const NETLIFY_NESTED_FUNCTION_DIRECTORIES = new Set(['auth']);

function buildNetlifyFallbackPath(path: string): string | null {
  const [pathname, search = ''] = path.split('?');
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length !== 2) {
    return null;
  }

  const [rootSegment] = segments;
  if (!NETLIFY_NESTED_FUNCTION_DIRECTORIES.has(rootSegment)) {
    return null;
  }

  const fallbackPathname = `/${segments.join('-')}`;
  return `${fallbackPathname}${search ? `?${search}` : ''}`;
}

export async function requestJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: RequestJsonOptions,
): Promise<T> {
  const targets = resolveRequestTargets(input);
  const networkMessage = options?.networkErrorMessage ?? 'No se pudo conectar con el servidor.';
  const invalidResponseMessage =
    options?.invalidResponseMessage ?? 'Respuesta JSON inválida del servidor.';
  let lastApiError: ApiError | null = null;
  let hadNetworkError = false;

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const isLastAttempt = index === targets.length - 1;
    let response: Response;

    try {
      response = await fetch(target, {
        headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
        credentials: init?.credentials ?? 'include',
        ...init,
      });
    } catch (error: unknown) {
      hadNetworkError = true;
      if (isLastAttempt) {
        throw new ApiError('NETWORK_ERROR', networkMessage, undefined);
      }
      continue;
    }

    let text = '';
    try {
      text = await response.text();
    } catch {
      text = '';
    }

    let json: any = {};
    if (text) {
      try {
        json = options?.parseJson ? options.parseJson(text) : JSON.parse(text);
      } catch {
        const error = new ApiError(
          'INVALID_RESPONSE',
          invalidResponseMessage,
          response.status || undefined,
        );
        lastApiError = error;
        if (isLastAttempt) {
          throw error;
        }
        continue;
      }
    }

    if (!response.ok || (json && typeof json === 'object' && json.ok === false)) {
      const message =
        json?.message ?? options?.defaultErrorMessage ?? 'No se pudo completar la solicitud.';
      const code = json?.error_code ?? options?.defaultErrorCode ?? `HTTP_${response.status}`;
      const error = new ApiError(code, message, response.status || undefined);

      if (!isLastAttempt && response.status === 404) {
        lastApiError = error;
        continue;
      }

      throw error;
    }

    return (json ?? {}) as T;
  }

  if (lastApiError) {
    throw lastApiError;
  }

  if (hadNetworkError) {
    throw new ApiError('NETWORK_ERROR', networkMessage, undefined);
  }

  throw new ApiError('UNKNOWN_ERROR', 'No se pudo completar la solicitud.', undefined);
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
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

export function pickNonEmptyString(
  ...values: Array<string | null | undefined>
): string | null {
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
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value ?? '').trim();
  return text.length ? text : null;
}
