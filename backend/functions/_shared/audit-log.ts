// backend/functions/_shared/audit-log.ts
import { Prisma, type PrismaClient } from '@prisma/client';
import { getPrisma } from './prisma';
import { parseCookies, SESSION_COOKIE_NAME } from './auth';

type PrismaClientOrTransaction =
  | PrismaClient
  | Prisma.TransactionClient;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

type AuditLogCreatePayload = Prisma.audit_logsUncheckedCreateInput;

export type LogAuditParams = {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: JsonValue | null;
  after?: JsonValue | null;
  prisma?: PrismaClientOrTransaction;
};

export type AuditUserSummary = {
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  createdAt: string | null;
};

export function buildUserDisplayName(
  user: { first_name?: string | null; last_name?: string | null; email?: string | null } | null,
): string | null {
  if (!user) {
    return null;
  }

  const firstName = typeof user.first_name === 'string' ? user.first_name.trim() : '';
  const lastName = typeof user.last_name === 'string' ? user.last_name.trim() : '';
  const parts = [firstName, lastName].filter((part) => part.length > 0);

  if (parts.length) {
    return parts.join(' ');
  }

  return typeof user.email === 'string' ? user.email.trim() : null;
}

export async function fetchLatestAuditEntries(params: {
  prisma: PrismaClientOrTransaction;
  entityType: string;
  entityIds: string[];
  actions?: string[];
}): Promise<Map<string, AuditUserSummary>> {
  const { prisma, entityType, entityIds, actions } = params;
  const normalizedIds = Array.from(new Set(entityIds.map((id) => id.trim()).filter(Boolean)));
  if (!normalizedIds.length) {
    return new Map();
  }

  const logs = await prisma.audit_logs.findMany({
    where: {
      entity_type: entityType,
      entity_id: { in: normalizedIds },
      ...(actions && actions.length ? { action: { in: actions } } : {}),
    },
    orderBy: { created_at: 'desc' },
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
  });

  const results = new Map<string, AuditUserSummary>();
  for (const log of logs) {
    const entityId = typeof log.entity_id === 'string' ? log.entity_id : '';
    if (!entityId || results.has(entityId)) {
      continue;
    }

    const userName = buildUserDisplayName(log.user);
    const userEmail = log.user?.email ?? null;
    const createdAt = log.created_at ? log.created_at.toISOString() : null;

    results.set(entityId, {
      userId: log.user_id ?? null,
      userName,
      userEmail,
      createdAt,
    });
  }

  return results;
}

export async function logAudit({
  userId,
  action,
  entityType,
  entityId,
  before,
  after,
  prisma,
}: LogAuditParams): Promise<void> {
  const client = prisma ?? getPrisma();

  const payload: AuditLogCreatePayload = {
    action,
    entity_type: entityType,
    entity_id: entityId,
    user_id: userId ?? null,
  };

  if (before !== undefined) {
    payload.before = before === null ? Prisma.JsonNull : (before as Prisma.InputJsonValue);
  }
  if (after !== undefined) {
    payload.after = after === null ? Prisma.JsonNull : (after as Prisma.InputJsonValue);
  }

  try {
    await client.audit_logs.create({ data: payload });
  } catch (error) {
    console.error('[audit-log] Failed to persist audit entry', {
      action,
      entityType,
      entityId,
      error,
    });
  }
}

export async function resolveUserIdFromEvent(
  event: { headers?: Record<string, string | undefined> | undefined },
  prisma: PrismaClient,
): Promise<string | null> {
  try {
    const headers = event.headers ?? {};
    const rawCookie =
      headers['cookie'] ??
      headers['Cookie'] ??
      headers['cookies'] ??
      headers['Cookies'];
    if (typeof rawCookie !== 'string' || !rawCookie.length) {
      return null;
    }

    const cookies = parseCookies(rawCookie);
    const rawSessionId = cookies[SESSION_COOKIE_NAME];
    if (!rawSessionId) {
      return null;
    }

    const sessionId = decodeURIComponent(rawSessionId);
    const session = await prisma.auth_sessions.findUnique({
      where: { id: sessionId },
      select: {
        user_id: true,
        expires_at: true,
        revoked_at: true,
        user: { select: { id: true, active: true } },
      },
    });

    if (!session || session.revoked_at) {
      return null;
    }

    if (session.expires_at && session.expires_at.getTime() <= Date.now()) {
      return null;
    }

    if (!session.user || !session.user.active) {
      return null;
    }

    return session.user.id;
  } catch (error) {
    console.error('[audit-log] Failed to resolve user from event', error);
    return null;
  }
}
