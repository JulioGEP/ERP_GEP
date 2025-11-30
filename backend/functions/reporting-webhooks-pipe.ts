import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { toMadridISOString } from './_shared/timezone';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function parseLimit(rawLimit?: string): number {
  if (!rawLimit) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(rawLimit, 10);
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
    select: {
      id: true,
      deal_id: true,
      status: true,
      message: true,
      warnings: true,
      created_at: true,
    },
  });

  const logs = events.map((event) => ({
    id: event.id,
    dealId: event.deal_id,
    status: event.status,
    message: event.message ?? null,
    warnings: Array.isArray(event.warnings)
      ? (event.warnings as string[])
      : null,
    createdAt: toMadridISOString(event.created_at),
  }));

  return successResponse({ logs });
});
