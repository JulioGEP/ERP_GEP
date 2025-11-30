import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { toMadridISOString } from './_shared/timezone';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function parseLimit(value: string | undefined): number {
  if (!value) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

export const handler = createHttpHandler(async (request) => {
  if (request.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  const prisma = getPrisma();
  const auth = await requireAuth(request, prisma, { requireRoles: ['Admin'] });
  if ('error' in auth) {
    return auth.error;
  }

  const limit = parseLimit(request.query.limit);

  const events = await prisma.deal_webhook_events.findMany({
    orderBy: { created_at: 'desc' },
    take: limit,
  });

  const entries = events.map((event) => ({
    id: event.id,
    dealId: event.deal_id,
    status: event.status,
    message: event.message ?? null,
    warnings: event.warnings ?? null,
    createdAt: toMadridISOString(event.created_at),
    updatedAt: toMadridISOString(event.updated_at),
  }));

  return successResponse({ events: entries });
});
