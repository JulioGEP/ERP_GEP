import { randomUUID } from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { logAudit, resolveUserIdFromEvent } from './audit-log';
import { getPrisma } from './prisma';
import { sendEmail } from './mailer';

export const CLIENT_HEADER_NAME = 'x-erp-client';
export const TRUSTED_CLIENT_HEADER_VALUE = 'frontend';
const SECURITY_ALERT_EMAIL = 'julio@gepgroup.es';

type HeaderValue = string | null;

type EventLike = {
  headers?: Record<string, string | undefined> | undefined;
  rawUrl?: string | null | undefined;
  ip?: string | null | undefined;
};

type PrismaClientOrTransaction = PrismaClient | Prisma.TransactionClient;

function normalizeHeaders(
  headers: Record<string, string | undefined> | undefined,
): Record<string, string> {
  if (!headers || typeof headers !== 'object') {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!key) continue;
    if (value === undefined || value === null) continue;
    normalized[key.toLowerCase()] = String(value);
  }
  return normalized;
}

function resolveClientIpFromHeaders(
  event: EventLike,
  headers: Record<string, string>,
): HeaderValue {
  const forwarded = headers['x-forwarded-for'];
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  const clientIp = headers['client-ip'];
  if (clientIp && clientIp.trim().length) {
    return clientIp.trim();
  }

  const eventIp = typeof event.ip === 'string' ? event.ip.trim() : null;
  if (eventIp) {
    return eventIp;
  }

  return null;
}

export function isTrustedClient(
  headers: Record<string, string | undefined> | undefined,
): boolean {
  const normalized = normalizeHeaders(headers);
  const headerValue = normalized[CLIENT_HEADER_NAME];
  if (!headerValue) {
    return false;
  }
  return headerValue.trim().toLowerCase() === TRUSTED_CLIENT_HEADER_VALUE;
}

type SuspiciousRequestParams = {
  event: EventLike;
  headers: Record<string, string | undefined> | undefined;
  method: string;
  path: string;
  rawUrl?: string | null | undefined;
  reason: string;
  prisma?: PrismaClientOrTransaction;
};

export async function logSuspiciousRequest({
  event,
  headers,
  method,
  path,
  rawUrl,
  reason,
  prisma,
}: SuspiciousRequestParams): Promise<void> {
  try {
    const normalizedHeaders = normalizeHeaders(headers);
    const prismaClient = prisma ?? getPrisma();
    const userId = await resolveUserIdFromEvent(event, prismaClient as PrismaClient);

    const clientHeader = normalizedHeaders[CLIENT_HEADER_NAME] ?? null;
    const origin = normalizedHeaders['origin'] ?? null;
    const referer = normalizedHeaders['referer'] ?? null;
    const userAgent = normalizedHeaders['user-agent'] ?? null;
    const ip = resolveClientIpFromHeaders(event, normalizedHeaders);

    const payload = {
      method,
      path,
      raw_url: rawUrl ?? null,
      reason,
      client_header: clientHeader,
      origin,
      referer,
      user_agent: userAgent,
      ip,
    } satisfies Record<string, HeaderValue>;

    await logAudit({
      userId,
      action: 'security.external_request',
      entityType: 'http_request',
      entityId: randomUUID(),
      before: null,
      after: payload as Prisma.InputJsonValue,
      prisma: prismaClient,
    });

    const subject = 'Alerta de acceso directo al backend';
    const details = [
      `Método: ${method}`,
      `Ruta: ${path}`,
      rawUrl ? `URL completa: ${rawUrl}` : null,
      ip ? `IP: ${ip}` : null,
      origin ? `Origin: ${origin}` : null,
      referer ? `Referer: ${referer}` : null,
      userAgent ? `User-Agent: ${userAgent}` : null,
      clientHeader ? `X-ERP-Client: ${clientHeader}` : 'X-ERP-Client: (ausente)',
      `Motivo: ${reason}`,
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n');

    const htmlBody = details
      .split('\n')
      .map((line) => `<p>${line.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
      .join('');

    await sendEmail({
      to: SECURITY_ALERT_EMAIL,
      subject,
      text: details,
      html: `<h2>Acceso sospechoso detectado</h2>${htmlBody}`,
    });
  } catch (error) {
    console.error('[security] Failed to log suspicious request', {
      error,
      method,
      path,
      reason,
    });
  }
}
