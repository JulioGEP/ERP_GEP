import { randomUUID } from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { logAudit, resolveUserIdFromEvent, type JsonValue } from './audit-log';
import { getPrisma } from './prisma';
import { sendEmail } from './mailer';

export const CLIENT_HEADER_NAME = 'x-erp-client';
export const TRUSTED_CLIENT_HEADER_VALUES = new Set(['frontend', 'pipedrive']);
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

const TRUSTED_FRONTEND_HOSTS = new Set(resolveTrustedFrontendHosts());

export function isTrustedClient(
  headers: Record<string, string | undefined> | undefined,
): boolean {
  const normalized = normalizeHeaders(headers);

  if (isPipedriveWebhook(normalized)) {
    return true;
  }

  const headerValue = normalized[CLIENT_HEADER_NAME];
  if (
    headerValue &&
    TRUSTED_CLIENT_HEADER_VALUES.has(headerValue.trim().toLowerCase())
  ) {
    return true;
  }

  return hasTrustedFrontendReferer(normalized);
}

function isPipedriveWebhook(headers: Record<string, string>): boolean {
  return (
    typeof headers['x-pipedrive-delivery-id'] === 'string' ||
    typeof headers['x-pipedrive-signature'] === 'string'
  );
}

function resolveTrustedFrontendHosts(): string[] {
  const candidates = [
    process.env.PUBLIC_FRONTEND_BASE_URL,
    process.env.PASSWORD_RESET_BASE_URL,
    process.env.URL,
    process.env.DEPLOY_PRIME_URL,
    process.env.DEPLOY_URL,
  ];

  const hosts = new Set<string>();

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (!trimmed.length) continue;
    try {
      const url = new URL(trimmed);
      if (url.host) {
        hosts.add(url.host.toLowerCase());
      }
    } catch {
      // Ignorar valores inválidos
    }
  }

  return Array.from(hosts);
}

function hasTrustedFrontendReferer(headers: Record<string, string>): boolean {
  if (!TRUSTED_FRONTEND_HOSTS.size) {
    return false;
  }

  const refererCandidates = [headers['origin'], headers['referer']];

  for (const candidate of refererCandidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    try {
      const url = new URL(candidate);
      const host = url.host.toLowerCase();
      if (TRUSTED_FRONTEND_HOSTS.has(host)) {
        return true;
      }
    } catch {
      // Ignorar valores inválidos
    }
  }

  return false;
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
      after: payload as JsonValue,
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
