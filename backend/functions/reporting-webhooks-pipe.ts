import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { toMadridISOString } from './_shared/timezone';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function parseLimit(raw: string | undefined): number {
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
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

  const logs = await prisma.webhooks_pipe.findMany({
    orderBy: { created_at: 'desc' },
    take: limit,
  });

  const entries = logs.map((log) => ({
    id: log.id,
    createdAt: toMadridISOString(log.created_at),
    dealId: log.deal_id,
    action: log.action,
    status: log.status,
    message: log.message ?? null,
    error: log.error_detail ?? null,
    client: log.client ?? null,
    payload: log.payload ?? null,
  }));

  return successResponse({ logs: entries });
});
