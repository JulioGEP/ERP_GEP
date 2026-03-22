import type { JsonValue } from './_shared/audit-log';
import { requireAuth } from './_shared/auth';
import { createHttpHandler } from './_shared/http';
import { getPrisma } from './_shared/prisma';
import { errorResponse, successResponse } from './_shared/response';
import { sendLeadFormToPipedrive } from './_shared/lead-form-pipedrive';
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
  pipedrive_organization_id: string | null;
  pipedrive_person_id: string | null;
  pipedrive_lead_id: string | null;
  pipedrive_synced_at: Date | null;
  slack_notified_at: Date | null;
  last_sync_error: string | null;
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
      return errorResponse('VALIDATION_ERROR', 'El identificador del lead es obligatorio.', 400);
    }

    try {
      const result = await sendLeadFormToPipedrive({
        prisma,
        webhookEventId: eventId,
      });

      return successResponse({
        message: result.alreadySynced
          ? 'El lead ya estaba sincronizado con Pipedrive.'
          : 'Lead enviado a Pipedrive correctamente.',
        result,
      });
    } catch (error) {
      console.error('[reporting-lead-form-webhooks] send to Pipedrive failed', error);
      try {
        await prisma.lead_form_webhooks.update({
          where: { id: eventId },
          data: {
            last_sync_error: error instanceof Error ? error.message : 'No se pudo enviar el lead a Pipedrive.',
          },
        });
      } catch (updateError) {
        console.error('[reporting-lead-form-webhooks] failed to store sync error', updateError);
      }
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
      pipedriveOrganizationId: record.pipedrive_organization_id,
      pipedrivePersonId: record.pipedrive_person_id,
      pipedriveLeadId: record.pipedrive_lead_id,
      pipedriveSyncedAt: toMadridISOString(record.pipedrive_synced_at),
      slackNotifiedAt: toMadridISOString(record.slack_notified_at),
      lastSyncError: record.last_sync_error,
    })),
  });
});
