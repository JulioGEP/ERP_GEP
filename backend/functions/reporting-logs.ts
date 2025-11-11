import { createHttpHandler } from './_shared/http';
import { errorResponse, successResponse } from './_shared/response';
import { requireAuth } from './_shared/auth';
import { getPrisma } from './_shared/prisma';
import { toMadridISOString } from './_shared/timezone';
import type { JsonValue } from './_shared/audit-log';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function parseLimitParam(rawLimit: string | undefined): number {
  if (!rawLimit) {
    return DEFAULT_LIMIT;
  }

  const parsed = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(parsed, MAX_LIMIT);
}

function buildUserFullName(
  user: { first_name: string | null; last_name: string | null } | null,
): string | null {
  if (!user) {
    return null;
  }

  const firstName = typeof user.first_name === 'string' ? user.first_name.trim() : '';
  const lastName = typeof user.last_name === 'string' ? user.last_name.trim() : '';

  const parts = [firstName, lastName].filter((part) => part.length > 0);
  if (parts.length === 0) {
    return null;
  }

  return parts.join(' ');
}

type AuditLogWithUser = {
  id: string;
  created_at: Date;
  action: string;
  entity_type: string;
  entity_id: string;
  user_id: string | null;
  before: JsonValue | null;
  after: JsonValue | null;
  user: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
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

  const logs = (await prisma.audit_logs.findMany({
    orderBy: { created_at: 'desc' },
    take: limit,
    include: {
      user: {
        select: {
          id: true,
          first_name: true,
          last_name: true,
          email: true,
        },
      },
    },
  })) as AuditLogWithUser[];

  const entries = logs.map((log) => ({
    id: log.id,
    createdAt: toMadridISOString(log.created_at),
    action: log.action,
    entityType: log.entity_type,
    entityId: log.entity_id,
    userId: log.user_id ?? null,
    userEmail: log.user?.email ?? null,
    userName: buildUserFullName(log.user) ?? log.user?.email ?? null,
    before: log.before ?? null,
    after: log.after ?? null,
  }));

  return successResponse({ logs: entries });
});
