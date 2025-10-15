// backend/functions/session_public_links.ts
import { randomBytes } from 'crypto';
import { validate as isUUID } from 'uuid';
import { getPrisma } from './_shared/prisma';
import { errorResponse, preflightResponse, successResponse } from './_shared/response';
import { nowInMadridDate, toMadridISOString } from './_shared/timezone';

const DEFAULT_TTL_HOURS = Number(process.env.PUBLIC_SESSION_LINK_TTL_HOURS ?? 24 * 30);
const MAX_TOKEN_LENGTH = 128;

function normalizeDealId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized.length) return false;
    return ['true', '1', 'yes', 'y', 'si', 'sí', 'on'].includes(normalized);
  }
  if (typeof value === 'number') return value !== 0;
  return Boolean(value);
}

function buildPublicPath(token: string): string {
  return `/public/sesiones/${encodeURIComponent(token)}/alumnos`;
}

function readHeader(headers: Record<string, unknown>, name: string): string | null {
  const direct = headers[name];
  if (typeof direct === 'string' && direct.trim().length) return direct;
  const lower = name.toLowerCase();
  const lowerValue = headers[lower];
  if (typeof lowerValue === 'string' && lowerValue.trim().length) return lowerValue;
  const upper = name.toUpperCase();
  const upperValue = headers[upper];
  if (typeof upperValue === 'string' && upperValue.trim().length) return upperValue;
  for (const key of Object.keys(headers || {})) {
    if (key.toLowerCase() === lower) {
      const value = headers[key];
      if (typeof value === 'string' && value.trim().length) return value;
    }
  }
  return null;
}

function buildPublicUrl(event: any, token: string): string {
  const headers = event?.headers ?? {};
  const protoHeader = readHeader(headers, 'x-forwarded-proto') || readHeader(headers, 'x-forwarded-protocol');
  const hostHeader = readHeader(headers, 'host');
  const protocol = typeof protoHeader === 'string' && protoHeader.trim().length ? protoHeader.split(',')[0].trim() : 'https';
  const host = typeof hostHeader === 'string' && hostHeader.trim().length ? hostHeader.trim() : '';
  const base = host ? `${protocol}://${host}` : '';
  return `${base}${buildPublicPath(token)}`;
}

function truncateValue(value: string | null | undefined, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function extractClientIp(event: any): string | null {
  const headers = event?.headers ?? {};
  const forwarded = readHeader(headers, 'x-forwarded-for');
  if (forwarded) {
    const ip = forwarded.split(',')[0]?.trim();
    if (ip) return ip;
  }
  const netlifyIp = readHeader(headers, 'x-nf-client-connection-ip');
  if (netlifyIp && netlifyIp.trim().length) return netlifyIp.trim();
  const realIp = readHeader(headers, 'x-real-ip');
  if (realIp && realIp.trim().length) return realIp.trim();
  const clientIp = readHeader(headers, 'client-ip');
  if (clientIp && clientIp.trim().length) return clientIp.trim();
  return null;
}

function extractUserAgent(event: any): string | null {
  const headers = event?.headers ?? {};
  const ua = readHeader(headers, 'user-agent');
  return ua ? ua.trim() : null;
}

function mapLinkForResponse(link: any, event: any) {
  if (!link) return null;
  const session = link.session ?? {};
  const sesionId = session.id ?? link.sesion_id ?? null;
  const dealId = session.deal_id ?? null;
  return {
    id: String(link.id ?? ''),
    deal_id: dealId ? String(dealId) : '',
    sesion_id: sesionId ? String(sesionId) : '',
    token: link.token,
    public_path: buildPublicPath(link.token),
    public_url: buildPublicUrl(event, link.token),
    created_at: toMadridISOString(link.created_at),
    updated_at: null,
    expires_at: toMadridISOString(link.expires_at),
    revoked_at: null,
    last_access_at: null,
    last_access_ip: null,
    last_access_ua: null,
    active: Boolean(link.active),
    ip_created: link.ip_created ?? null,
    user_agent: link.user_agent ?? null,
  };
}

function generateToken(): string {
  return randomBytes(32).toString('base64url').slice(0, MAX_TOKEN_LENGTH);
}

function computeExpiration(hours: number): Date {
  const ttl = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TTL_HOURS;
  const now = nowInMadridDate();
  now.setHours(now.getHours() + ttl);
  return now;
}

async function getActiveLink(prisma: ReturnType<typeof getPrisma>, sessionId: string) {
  const now = new Date();
  return prisma.tokens.findFirst({
    where: {
      sesion_id: sessionId,
      active: true,
      OR: [
        { expires_at: null },
        { expires_at: { gt: now } },
      ],
    },
    orderBy: { created_at: 'desc' },
    include: {
      session: { select: { id: true, deal_id: true } },
    },
  });
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return preflightResponse();
    }

    const method = event.httpMethod ?? 'GET';
    const prisma = getPrisma();

    if (method === 'GET') {
      const params = event.queryStringParameters || {};
      const dealId =
        normalizeDealId(params.deal_id) ||
        normalizeDealId(params.dealId) ||
        normalizeDealId(params.dealID);
      const sessionId =
        normalizeDealId(params.sesion_id) ||
        normalizeDealId(params.session_id) ||
        normalizeDealId(params.sessionId) ||
        normalizeDealId(params.sesionId);

      if (!dealId) {
        return errorResponse('VALIDATION_ERROR', 'deal_id requerido', 400);
      }
      if (!sessionId || !isUUID(sessionId)) {
        return errorResponse('VALIDATION_ERROR', 'sesion_id inválido (UUID requerido)', 400);
      }

      const session = await prisma.sessions.findUnique({
        where: { id: sessionId },
        select: { id: true, deal_id: true },
      });

      if (!session || session.deal_id !== dealId) {
        return errorResponse('NOT_FOUND', 'Sesión no encontrada para el deal', 404);
      }

      const link = await getActiveLink(prisma, sessionId);
      if (!link) {
        return successResponse({ link: null });
      }

      return successResponse({ link: mapLinkForResponse(link, event) });
    }

    if (method === 'POST') {
      if (!event.body) {
        return errorResponse('VALIDATION_ERROR', 'Body requerido', 400);
      }

      let payload: any = {};
      try {
        payload = JSON.parse(event.body || '{}');
      } catch {
        return errorResponse('VALIDATION_ERROR', 'Body JSON inválido', 400);
      }
      const dealId = normalizeDealId(payload.deal_id);
      const sessionId = normalizeDealId(payload.sesion_id);
      const forceRegenerate =
        normalizeBoolean(payload.regenerate) ||
        normalizeBoolean(payload.force) ||
        normalizeBoolean(payload.forceRegenerate);
      const ttlHours = Number(payload.ttl_hours ?? payload.ttlHours ?? payload.ttl) || DEFAULT_TTL_HOURS;

      if (!dealId) {
        return errorResponse('VALIDATION_ERROR', 'deal_id requerido', 400);
      }
      if (!sessionId || !isUUID(sessionId)) {
        return errorResponse('VALIDATION_ERROR', 'sesion_id inválido (UUID requerido)', 400);
      }

      const session = await prisma.sessions.findUnique({
        where: { id: sessionId },
        select: { id: true, deal_id: true },
      });

      if (!session || session.deal_id !== dealId) {
        return errorResponse('NOT_FOUND', 'Sesión no encontrada para el deal', 404);
      }

      const activeLink = await getActiveLink(prisma, sessionId);
      if (activeLink && !forceRegenerate) {
        return successResponse({ link: mapLinkForResponse(activeLink, event) });
      }

      const now = nowInMadridDate();
      const ip = truncateValue(extractClientIp(event), 255);
      const userAgent = truncateValue(extractUserAgent(event), 1024);

      await prisma.tokens.updateMany({
        where: { sesion_id: sessionId, active: true },
        data: { active: false },
      });

      const token = generateToken();
      const expiresAt = computeExpiration(ttlHours);

      const created = await prisma.tokens.create({
        data: {
          sesion_id: sessionId,
          token,
          created_at: now,
          expires_at: expiresAt,
          active: true,
          ip_created: ip,
          user_agent: userAgent,
        },
        include: { session: { select: { id: true, deal_id: true } } },
      });

      return successResponse({ link: mapLinkForResponse(created, event) }, 201);
    }

    return errorResponse('NOT_IMPLEMENTED', 'Ruta o método no soportado', 404);
  } catch (error: any) {
    const message = error?.message || 'Unexpected error';
    return errorResponse('UNEXPECTED', message, 500);
  }
};
