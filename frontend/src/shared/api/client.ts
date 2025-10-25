import { ApiError } from '../../features/presupuestos/api';

export type RequestJsonOptions = {
  defaultErrorMessage?: string;
  defaultErrorCode?: string;
  networkErrorMessage?: string;
  invalidResponseMessage?: string;
  parseJson?: (text: string) => any;
};

export async function requestJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: RequestJsonOptions,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(input, init);
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
    } catch (error) {
      const message = options?.invalidResponseMessage ?? 'Respuesta JSON inválida del servidor.';
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
