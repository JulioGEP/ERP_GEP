import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { toMadridISOString } from './_shared/timezone';
import type { JsonValue } from './_shared/audit-log';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function parseLimitParam(rawLimit: string | undefined): number {
  if (!rawLimit) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

type PipedriveWebhookEventRecord = {
  id: string;
  created_at: Date;
  event: string | null;
  event_action: string | null;
  event_object: string | null;
  company_id: number | null;
  object_id: number | null;
  retry: number | null;
  webhook_token: string | null;
  headers: JsonValue | null;
  payload: JsonValue;
};

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ['Admin'] });
  if ('error' in auth) {
    return auth.error;
  }

  const limit = parseLimitParam(request.query.limit);

  const events = (await prisma.pipedrive_webhook_events.findMany({
    orderBy: { created_at: 'desc' },
    take: limit,
  })) as PipedriveWebhookEventRecord[];

  const normalized = events.map((event) => ({
    id: event.id,
    createdAt: toMadridISOString(event.created_at),
    event: event.event ?? null,
    eventAction: event.event_action ?? null,
    eventObject: event.event_object ?? null,
    companyId: event.company_id ?? null,
    objectId: event.object_id ?? null,
    retry: event.retry ?? null,
    webhookToken: event.webhook_token ?? null,
    headers: event.headers ?? null,
    payload: event.payload ?? null,
  }));

  return successResponse({ events: normalized });
});
