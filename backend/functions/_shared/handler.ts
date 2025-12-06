import type { HandlerContext, HandlerEvent } from '@netlify/functions';

import { errorResponse, preflightResponse, successResponse } from './response';
import { isTrustedClient, logSuspiciousRequest } from './security';

type NetlifyResponse = {
  statusCode: number;
  headers?: Record<string, string>;
  body?: unknown;
  isBase64Encoded?: boolean;
};

type HandlerResult = NetlifyResponse | Record<string, unknown> | void | null;

type Handler<TEvent extends HandlerEvent = HandlerEvent> = (
  event: TEvent,
  context: HandlerContext,
) => Promise<HandlerResult> | HandlerResult;

function isNetlifyResponse(result: unknown): result is NetlifyResponse {
  return Boolean(
    result &&
      typeof result === 'object' &&
      'statusCode' in result &&
      typeof (result as any).statusCode === 'number',
  );
}

function normalizeResponse(result: HandlerResult) {
  if (result === undefined || result === null) {
    return successResponse();
  }

  if (isNetlifyResponse(result)) {
    return result;
  }

  return successResponse(result);
}

export function validateClient(event: HandlerEvent) {
  if (isTrustedClient(event.headers)) {
    return {
      client: event.headers?.['x-erp-client'] ?? null,
    } as const;
  }

  const method = String(event.httpMethod || 'GET').toUpperCase();
  const path = event.path ?? '';

  logSuspiciousRequest({
    event,
    headers: event.headers,
    method,
    path,
    rawUrl: (event as any)?.rawUrl ?? null,
    reason: 'missing_or_invalid_client_header',
  }).catch((error) => {
    console.error('[handler] Error registrando petición sospechosa', error);
  });

  throw errorResponse('FORBIDDEN', 'Cliente no autorizado para acceder al backend', 403);
}

export function createHandler<TEvent extends HandlerEvent = HandlerEvent>(
  handler: Handler<TEvent>,
) {
  return async function netlifyHandler(event: TEvent, context: HandlerContext) {
    if (String(event.httpMethod || '').toUpperCase() === 'OPTIONS') {
      return preflightResponse();
    }

    try {
      const result = await handler(event, context);
      return normalizeResponse(result);
    } catch (error) {
      if (isNetlifyResponse(error)) {
        return error;
      }

      const message =
        error instanceof Error
          ? error.message || 'Se ha producido un error inesperado'
          : 'Se ha producido un error inesperado';

      console.error(
        `[handler] Error procesando ${event.httpMethod ?? 'UNKNOWN'} ${event.path ?? ''}`,
        error,
      );
      return errorResponse('INTERNAL_ERROR', message, 500);
    }
  };
}
