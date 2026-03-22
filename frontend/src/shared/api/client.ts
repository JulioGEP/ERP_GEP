import { ApiError } from '../../features/presupuestos/api';

export type RequestJsonOptions = {
  defaultErrorMessage?: string;
  defaultErrorCode?: string;
  networkErrorMessage?: string;
  invalidResponseMessage?: string;
  parseJson?: (text: string) => any;
};

function buildInvalidJsonMessage(response: Response, raw: string, fallbackMessage?: string): string {
  const baseMessage = fallbackMessage ?? 'Respuesta JSON inválida del servidor.';
  const collapsedPreview = raw.replace(/\s+/g, ' ').trim().slice(0, 800);
  const contentType = response.headers.get('content-type');
  const headerRequestId = response.headers.get('x-nf-request-id') ?? response.headers.get('x-request-id');
  const bodyRequestIdMatch = raw.match(/\bID:\s*([A-Z0-9_-]+)\b/i);
  const requestId = headerRequestId ?? bodyRequestIdMatch?.[1];
  const details = [
    `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
    contentType ? `Content-Type: ${contentType}` : null,
    requestId ? `Request ID: ${requestId}` : null,
    response.url ? `URL: ${response.url}` : null,
    collapsedPreview ? `Respuesta recibida: ${collapsedPreview}` : null,
  ].filter(Boolean);

  return details.length ? `${baseMessage} ${details.join('. ')}` : baseMessage;
}

export async function requestJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: RequestJsonOptions,
): Promise<T> {
  const finalInit: RequestInit = {
    ...init,
    credentials: init?.credentials ?? 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-ERP-Client': 'frontend',
      ...(init?.headers || {}),
    },
  };

  let response: Response;

  try {
    response = await fetch(input, finalInit);
  } catch (error: unknown) {
    const message = options?.networkErrorMessage ?? 'No se pudo conectar con el servidor.';
    throw new ApiError('NETWORK_ERROR', message, undefined);
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
      const message = buildInvalidJsonMessage(response, text, options?.invalidResponseMessage);
      throw new ApiError('INVALID_RESPONSE', message, response.status || undefined);
    }
  }

  if (!response.ok || (json && typeof json === 'object' && json.ok === false)) {
    const message = json?.message ?? options?.defaultErrorMessage ?? 'No se pudo completar la solicitud.';
    const code = json?.error_code ?? options?.defaultErrorCode ?? `HTTP_${response.status}`;
    throw new ApiError(code, message, response.status || undefined);
  }

  return (json ?? {}) as T;
}
