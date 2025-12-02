// backend/functions/pipedrive-webhooks.ts
import { randomUUID } from 'crypto';
import type { Handler } from '@netlify/functions';
import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { requireAuth } from './_shared/auth';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';

const ALLOWED_ROLES = ['Admin', 'Administracion', 'Logistica', 'People'] as const;

const listWebhooksHandler = createHttpHandler(async (request) => {
  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ALLOWED_ROLES });
  if ('error' in auth) return auth.error;

  const records = await prisma.pipedrive_webhooks.findMany({
    orderBy: { received_at: 'desc' },
    take: 200,
  });

  return successResponse({
    ok: true,
    webhooks: records.map((record) => ({
      id: record.id,
      request_uuid: record.request_uuid,
      received_at: record.received_at?.toISOString() ?? null,
      updated_at: record.updated_at?.toISOString() ?? null,
      payload: record.payload,
    })),
  });
});

function decodeBody(event: Parameters<Handler>[0]): { raw: string; error?: null } | { raw?: null; error: ReturnType<typeof errorResponse> } {
  if (!event.body) return { raw: '' };
  const raw = event.isBase64Encoded
    ? (() => {
        try {
          return Buffer.from(event.body as string, 'base64').toString('utf8');
        } catch (error) {
          console.error('[pipedrive-webhooks] Error decoding base64 body', error);
          return null;
        }
      })()
    : event.body;

  if (raw === null) {
    return { error: errorResponse('INVALID_BODY', 'No se pudo decodificar el cuerpo de la petición', 400) };
  }

  return { raw } as { raw: string };
}

export const handler: Handler = async (event, context) => {
  const method = String(event.httpMethod || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    return preflightResponse();
  }

  if (method === 'POST') {
    const { raw, error } = decodeBody(event);
    if (error) return error;

    let payload: unknown = {};
    if (raw && raw.trim().length) {
      try {
        payload = JSON.parse(raw);
      } catch (parseError) {
        console.error('[pipedrive-webhooks] Invalid JSON payload', parseError);
        return errorResponse('INVALID_JSON', 'El cuerpo debe ser JSON válido', 400);
      }
    }

    const prisma = getPrisma();

    try {
      const created = await prisma.pipedrive_webhooks.create({
        data: {
          request_uuid: randomUUID(),
          payload,
        },
      });

      return successResponse({
        ok: true,
        id: created.id,
        request_uuid: created.request_uuid,
      });
    } catch (creationError) {
      console.error('[pipedrive-webhooks] Failed to store webhook payload', creationError);
      return errorResponse('PERSISTENCE_ERROR', 'No se pudo guardar el webhook', 500);
    }
  }

  return listWebhooksHandler(event as any, context as any);
};
