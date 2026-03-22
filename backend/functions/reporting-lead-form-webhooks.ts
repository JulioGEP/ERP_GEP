import type { JsonValue } from './_shared/audit-log';
import { requireAuth } from './_shared/auth';
import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { sendLeadFormWebhookToPipedrive } from './_shared/lead-form-pipedrive';
import { toMadridISOString } from './_shared/timezone';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

type LeadFormWebhookRecord = {
  id: string;
  created_at: Date;
  source: string | null;
  event_name: string | null;
  form_name: string | null;
  entry_id: string | null;
  lead_name: string | null;
  lead_email: string | null;
  lead_phone: string | null;
  lead_message: string | null;
  request_headers: JsonValue | null;
  payload_json: JsonValue;
};

function parseLimitParam(rawLimit: string | undefined): number {
  if (!rawLimit) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

export const handler = createHttpHandler(async (request) => {
  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ['Admin'] });
  if ('error' in auth) {
    return auth.error;
  }

  if (request.method === 'POST') {
    const eventId = typeof request.body === 'object' && request.body !== null ? String((request.body as any).eventId ?? '').trim() : '';
    if (!eventId.length) {
      return errorResponse('VALIDATION_ERROR', 'El identificador del webhook es obligatorio.', 400);
    }

    try {
      const result = await sendLeadFormWebhookToPipedrive({
        prisma,
        webhookEventId: eventId,
      });

      return successResponse({
        message: 'Lead enviado a Pipedrive correctamente.',
        result,
      });
    } catch (error) {
      console.error('[reporting-lead-form-webhooks] send to Pipedrive failed', error);
      return errorResponse(
        'PIPEDRIVE_SYNC_ERROR',
        error instanceof Error ? error.message : 'No se pudo enviar el lead a Pipedrive.',
        500,
      );
    }
  }

  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const records = (await prisma.lead_form_webhooks.findMany({
    orderBy: { created_at: 'desc' },
    take: parseLimitParam(request.query.limit),
  })) as LeadFormWebhookRecord[];

  return successResponse({
    events: records.map((record) => ({
      id: record.id,
      createdAt: toMadridISOString(record.created_at),
      source: record.source,
      eventName: record.event_name,
      formName: record.form_name,
      entryId: record.entry_id,
      leadName: record.lead_name,
      leadEmail: record.lead_email,
      leadPhone: record.lead_phone,
      leadMessage: record.lead_message,
      requestHeaders: record.request_headers,
      payload: record.payload_json,
    })),
  });
});
