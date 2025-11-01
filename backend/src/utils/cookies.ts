// === cookies.ts ===
import { createHash } from 'crypto';

const IS_PROD = process.env.NODE_ENV === 'production';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || null; // ej: ".gepgroup.es"

// Si hay domain => __Secure-session (permite Domain=...)
// Si no hay domain (mismo host) => __Host-session
const SESSION_COOKIE_NAME =
  IS_PROD && COOKIE_DOMAIN
    ? '__Secure-session'
    : IS_PROD
    ? '__Host-session'
    : 'session';

type CookieOpts = {
  domain?: string | null;       // No usar con __Host-
  sameSite?: 'Lax' | 'Strict' | 'None';
  secure?: boolean | null;
  path?: string;
  priority?: 'High' | 'Medium' | 'Low';
};

function shouldUseSecureCookies(): boolean {
  if (typeof process !== 'undefined' && process.env.FORCE_SECURE_COOKIES === 'true') return true;
  // En Netlify/Vercel suele haber HTTPS; ajusta si necesitas
  return !!(process.env.URL?.startsWith('https://') || process.env.DEPLOY_URL?.startsWith('https://'));
}

function buildSetCookieString(
  name: string,
  value: string,
  expiresAt: Date | null,
  opts: CookieOpts = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  const path = opts.path ?? '/';
  parts.push(`Path=${path}`);

  // __Host- requiere Secure, Path=/ y no Domain
  const isHostPrefixed = name.startsWith('__Host-');
  const secure = opts.secure ?? shouldUseSecureCookies() || isHostPrefixed;
  if (secure) parts.push('Secure');

  // SameSite
  const sameSite = opts.sameSite ?? 'Lax';
  parts.push(`SameSite=${sameSite}`);
  // HttpOnly siempre para sesión
  parts.push('HttpOnly');

  // Domain solo si NO usamos __Host-
  const domain = isHostPrefixed ? null : (opts.domain ?? null);
  if (domain) parts.push(`Domain=${domain}`);

  // Max-Age / Expires
  if (expiresAt) {
    const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    parts.push(`Max-Age=${maxAge}`);
    parts.push(`Expires=${expiresAt.toUTCString()}`);
  } else {
    parts.push('Max-Age=0');
    parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  }

  // Priority (Chrome): ayuda a que no se purgue
  parts.push(`Priority=${opts.priority ?? 'High'}`);

  return parts.join('; ');
}

export function buildSessionCookie(
  sessionId: string,
  expiresAt: Date,
  opts: Partial<CookieOpts> = {},
): string {
  const useCrossSite = Boolean(COOKIE_DOMAIN); // si hay dominio, vamos cross-site
  return buildSetCookieString(
    SESSION_COOKIE_NAME,
    sessionId,
    expiresAt,
    {
      sameSite: opts.sameSite ?? (useCrossSite ? 'None' : 'Lax'),
      secure: opts.secure ?? (useCrossSite ? true : null),
      path: opts.path ?? '/',
      priority: opts.priority ?? 'High',
      // NO Domain si usamos __Host-, SÍ si usamos __Secure- (cross-site)
      domain: SESSION_COOKIE_NAME.startsWith('__Host-') ? null : (opts.domain ?? (COOKIE_DOMAIN || undefined)),
    },
  );
}

export function buildClearSessionCookie(opts: Partial<CookieOpts> = {}): string {
  const useCrossSite = Boolean(COOKIE_DOMAIN);
  return buildSetCookieString(
    SESSION_COOKIE_NAME,
    '',
    null, // Max-Age=0 + Expires pasado (lo hace buildSetCookieString)
    {
      sameSite: opts.sameSite ?? (useCrossSite ? 'None' : 'Lax'),
      secure: opts.secure ?? (useCrossSite ? true : null),
      path: opts.path ?? '/',
      priority: opts.priority ?? 'High',
      // NO Domain si usamos __Host-, SÍ si usamos __Secure-
      domain: SESSION_COOKIE_NAME.startsWith('__Host-') ? null : (opts.domain ?? (COOKIE_DOMAIN || undefined)),
    },
  );
}

// === cookie parsing & extraction ===
export function parseCookies(header: string | string[] | undefined): Record<string, string> {
  if (!header) return {};
  const raw = Array.isArray(header) ? header.join('; ') : header;
  const out: Record<string, string> = {};
  for (const chunk of raw.split(';')) {
    const eq = chunk.indexOf('=');
    if (eq === -1) continue;
    const rawName = chunk.slice(0, eq).trim();
    if (!rawName) continue;
    let rawVal = chunk.slice(eq + 1).trim();
    // quitar comillas envolventes si existen
    if ((rawVal.startsWith('"') && rawVal.endsWith('"')) || (rawVal.startsWith("'") && rawVal.endsWith("'"))) {
      rawVal = rawVal.slice(1, -1);
    }
    try {
      out[rawName] = decodeURIComponent(rawVal);
    } catch {
      out[rawName] = rawVal;
    }
  }
  return out;
}

type HttpHeaders = Record<string, unknown>;

function getHeader(headers: HttpHeaders, key: string): unknown {
  if (!headers) return undefined;
  // case-insensitive
  const lower = Object.create(null) as Record<string, unknown>;
  for (const k of Object.keys(headers)) lower[k.toLowerCase()] = (headers as any)[k];
  return lower[key.toLowerCase()];
}

export function extractSessionIdFromRequest(request: { headers: HttpHeaders }): string | null {
  const cookieHeader = getHeader(request.headers, 'cookie') ?? getHeader(request.headers, 'cookies');
  const cookies = parseCookies(cookieHeader as any);
  const sessionId = cookies[SESSION_COOKIE_NAME];
  // Validar formato básico (opcional: UUID v4 36 chars)
  if (!sessionId || sessionId.length < 16) return null;
  return sessionId;
}

// === IP utilities ===
export function resolveClientIp(request: { headers: HttpHeaders; event?: any }): string | null {
  const pick = (...values: Array<unknown>): string | null => {
    for (const v of values) {
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
  };

  const xfwd = String(getHeader(request.headers, 'x-forwarded-for') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (xfwd.length) return xfwd[0];

  return pick(
    getHeader(request.headers, 'cf-connecting-ip'),
    getHeader(request.headers, 'x-real-ip'),
    getHeader(request.headers, 'x-client-ip'),
    getHeader(request.headers, 'client-ip'),
    request?.event?.ip,
  );
}

export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash('sha256').update(ip).digest('hex');
}
