import { createHash, randomBytes } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { setRefreshSessionCookie, type HttpRequest } from './http';
import { errorResponse } from './response';

export const SESSION_COOKIE_NAME = 'erp_session';
const SESSION_DURATION_MS = 3 * 60 * 60 * 1000; // 3 horas
const RESET_TOKEN_DURATION_MS = 60 * 60 * 1000; // 1 hora

// Exportado por si otros módulos necesitan el mapping
export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  Admin: ['ALL'],
  Comercial: ['/dashboard', '/perfil', '/presupuestos/sinplanificar', '/presupuestos/*', '/calendario/*'],
  Administracion: [
    '/dashboard',
    '/perfil',
    '/presupuestos/sinplanificar',
    '/presupuestos/*',
    '/calendario/*',
    '/certificados',
    '/certificados/*',
  ],
  Logistica: [
    '/dashboard',
    '/perfil',
    '/presupuestos/sinplanificar',
    '/presupuestos/*',
    '/calendario/*',
    '/recursos/unidades_moviles',
    '/recursos/salas',
  ],
  People: [
    '/dashboard',
    '/perfil',
    '/presupuestos/sinplanificar',
    '/presupuestos/*',
    '/calendario/*',
    '/recursos/formadores_bomberos',
  ],
  Formador: ['/usuarios/trainer/*', '/perfil'],
};

export function normalizeRoleKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  return trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const ROLE_LABEL_TO_STORAGE_ENTRIES = [
  ['Admin', 'admin'],
  ['Comercial', 'comercial'],
  ['Administracion', 'administracion'],
  ['Logistica', 'logistica'],
  ['People', 'people'],
  ['Formador', 'Formador'],
] as const;

const ROLE_LABEL_TO_STORAGE = new Map<string, string>(ROLE_LABEL_TO_STORAGE_ENTRIES);
const ROLE_STORAGE_TO_LABEL = new Map<string, string>(
  ROLE_LABEL_TO_STORAGE_ENTRIES.map(([label, storage]) => [storage, label]),
);

const NORMALIZED_ROLE_TO_STORAGE = new Map<string, string>(
  ROLE_LABEL_TO_STORAGE_ENTRIES.flatMap(([label, storage]) => {
    const normalizedLabel = normalizeRoleKey(label);
    const normalizedStorage = normalizeRoleKey(storage);
    const entries: Array<[string, string]> = [];
    if (normalizedLabel) entries.push([normalizedLabel, storage]);
    if (normalizedStorage) entries.push([normalizedStorage, storage]);
    return entries;
  }),
);

const NORMALIZED_ROLE_TO_LABEL = new Map<string, string>(
  ROLE_LABEL_TO_STORAGE_ENTRIES.flatMap(([label, storage]) => {
    const normalizedLabel = normalizeRoleKey(label);
    const normalizedStorage = normalizeRoleKey(storage);
    const entries: Array<[string, string]> = [];
    if (normalizedLabel) entries.push([normalizedLabel, label]);
    if (normalizedStorage) entries.push([normalizedStorage, label]);
    return entries;
  }),
);

export const ROLE_DISPLAY_NAMES: readonly string[] = ROLE_LABEL_TO_STORAGE_ENTRIES.map(
  ([label]) => label,
);

export function getRoleStorageValue(role: string | null | undefined): string | null {
  const normalized = normalizeRoleKey(role);
  if (!normalized) return null;
  return NORMALIZED_ROLE_TO_STORAGE.get(normalized) ?? null;
}

export function getRoleDisplayValue(role: string | null | undefined): string | null {
  const normalized = normalizeRoleKey(role);
  if (!normalized) return null;

  const storage = NORMALIZED_ROLE_TO_STORAGE.get(normalized);
  if (storage) {
    const display = ROLE_STORAGE_TO_LABEL.get(storage);
    if (display) return display;
  }

  return NORMALIZED_ROLE_TO_LABEL.get(normalized) ?? null;
}

// Exportado para que el front o los guards puedan reutilizar el orden por defecto
export const DEFAULT_ROUTE_ORDER = [
  '/dashboard',
  '/usuarios/trainer/dashboard',
  '/usuarios/trainer/calendario',
  '/usuarios/trainer/sesiones',
  '/usuarios/trainer/disponibilidad',
  '/presupuestos/sinplanificar',
  '/recursos/formadores_bomberos',
  '/recursos/trainer',
  '/recursos/unidades_moviles',
  '/recursos/salas',
  '/certificados',
  '/certificados/templates_certificados',
  '/calendario/por_sesiones',
  '/calendario/por_formador',
  '/calendario/por_unidad_movil',
  '/informes/formacion',
  '/informes/preventivo',
  '/informes/simulacro',
  '/informes/recurso_preventivo_ebro',
  '/usuarios',
];

export type UserRecord = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  active: boolean;
  password_hash?: string | null;
  password_algo?: string | null;
  password_updated_at?: Date | null;
  reset_token?: string | null;
  reset_token_expires?: Date | null;
  reset_requested_at?: Date | null;
  reset_used_at?: Date | null;
};

export type AuthSessionRecord = {
  id: string;
  user_id: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  ip_hash: string | null;
  user_agent: string | null;
  user?: UserRecord | null;
};

export type AuthenticatedContext = {
  session: AuthSessionRecord;
  user: UserRecord;
  permissions: readonly string[];
  refreshedCookie?: string | null;
};

export type RequireAuthOptions = {
  requireRoles?: readonly string[];
};

export function getPermissionsForRole(role: string | null | undefined): readonly string[] {
  const normalized = normalizeRoleKey(role);
  if (!normalized) return [];

  for (const [roleName, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    if (normalizeRoleKey(roleName) === normalized) {
      return permissions;
    }
  }

  return [];
}

export function computeDefaultPath(permissions: readonly string[]): string {
  if (permissions.includes('ALL')) {
    return DEFAULT_ROUTE_ORDER[0];
  }
  for (const route of DEFAULT_ROUTE_ORDER) {
    if (hasPermission(route, permissions)) {
      return route;
    }
  }
  if (hasPermission('/perfil', permissions)) {
    return '/perfil';
  }
  return '/';
}

export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const normalized = input.trim().toLowerCase();
  return normalized.length ? normalized : null;
}

export function shouldUseSecureCookies(): boolean {
  if (process.env.FORCE_SECURE_COOKIE === 'true') return true;
  if (process.env.DISABLE_SECURE_COOKIE === 'true') return false;
  // En netlify dev no marcamos Secure
  if (process.env.NETLIFY_DEV === 'true') return false;
  return process.env.NODE_ENV === 'production';
}

export function buildSessionCookie(sessionId: string, expiresAt: Date): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (shouldUseSecureCookies()) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearSessionCookie(): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (shouldUseSecureCookies()) parts.push('Secure');
  return parts.join('; ');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const entries: Record<string, string> = {};
  // Soportar múltiples cookies separadas por ';'
  for (const chunk of header.split(';')) {
    const [rawName, ...rest] = chunk.split('=');
    const name = rawName?.trim();
    if (!name) continue;
    const value = rest.join('=').trim();
    entries[name] = value;
  }
  return entries;
}

export function extractSessionIdFromRequest(request: HttpRequest<any>): string | null {
  const cookieHeader = request.headers['cookie'] ?? request.headers['cookies'];
  if (!cookieHeader) return null;
  const cookies = parseCookies(cookieHeader);
  const sessionId = cookies[SESSION_COOKIE_NAME];
  return sessionId && sessionId.length ? decodeURIComponent(sessionId) : null;
}

function isSessionActive(
  session: AuthSessionRecord | null | undefined,
): session is AuthSessionRecord {
  if (!session) return false;
  if (session.revoked_at) return false;
  if (!session.expires_at) return false;
  return session.expires_at.getTime() > Date.now();
}

export async function findActiveSession(
  prisma: PrismaClient,
  sessionId: string,
): Promise<AuthenticatedContext | null> {
  // Usamos bracket-notation para que el tipado de Prisma no se queje en TS
  const session = (await (prisma as any)['auth_sessions'].findUnique({
    where: { id: sessionId },
    include: { user: true },
  })) as (AuthSessionRecord & { user: UserRecord | null }) | null;

  if (!session || !isSessionActive(session) || !session.user || !session.user.active) {
    return null;
  }

  let refreshedCookie: string | null = null;
  const newExpiresAt = getSessionExpirationDate();

  try {
    await (prisma as any)['auth_sessions'].update({
      where: { id: session.id },
      data: { expires_at: newExpiresAt },
    });
    session.expires_at = newExpiresAt;
    refreshedCookie = buildSessionCookie(session.id, newExpiresAt);
  } catch (error) {
    console.error('[auth] Failed to refresh session expiration', {
      sessionId,
      error,
    });
  }

  const permissions = getPermissionsForRole(session.user.role);
  return { session, user: session.user, permissions, refreshedCookie };
}


export async function requireAuth(
  request: HttpRequest<any>,
  prisma: PrismaClient,
  options?: RequireAuthOptions,
): Promise<AuthenticatedContext | { error: ReturnType<typeof errorResponse> }> {
  const sessionId = extractSessionIdFromRequest(request);
  if (!sessionId) {
    return { error: errorResponse('UNAUTHORIZED', 'Sesión no válida o expirada', 401) };
  }

  const result = await findActiveSession(prisma, sessionId);
  if (!result) {
    return { error: errorResponse('UNAUTHORIZED', 'Sesión no válida o expirada', 401) };
  }

  if (result.refreshedCookie) {
    setRefreshSessionCookie(request, result.refreshedCookie);
  }

  if (options?.requireRoles && options.requireRoles.length) {
    const role = normalizeRoleKey(result.user.role);
    const allowedRoles = options.requireRoles
      .map((value) => normalizeRoleKey(value))
      .filter((value): value is string => !!value);

    if (!role || !allowedRoles.includes(role)) {
      return { error: errorResponse('FORBIDDEN', 'No tienes permisos para esta operación', 403) };
    }
  }

  return result;
}

export function resolveClientIp(request: HttpRequest<any>): string | null {
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    const parts = forwarded.split(',');
    const first = parts[0]?.trim();
    if (first) return first;
  }
  const rawIp = (request as any)?.event?.ip ?? request.headers['client-ip'];
  if (typeof rawIp === 'string' && rawIp.trim().length) {
    return rawIp.trim();
  }
  return null;
}

export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash('sha256').update(ip).digest('hex');
}

export function hasPermission(path: string, permissions: readonly string[]): boolean {
  if (!path) return false;
  if (!permissions.length) return false;
  if (permissions.includes('ALL')) return true;

  const normalizedPath = normalizePath(path);

  return permissions.some((permission) => {
    const normalizedPermission = normalizePath(permission);
    if (normalizedPermission === normalizedPath) return true;
    if (normalizedPermission.endsWith('/*')) {
      const base = normalizedPermission.slice(0, -2);
      return normalizedPath === base || normalizedPath.startsWith(`${base}/`);
    }
    return false;
  });
}

function normalizePath(path: string): string {
  if (!path) return '';
  if (path === '/') return '/';
  const trimmed = path.trim();
  if (!trimmed.length) return '';
  const normalized = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  return normalized || '/';
}

const RESET_TOKEN_BYTE_LENGTH = 16; // 16 bytes → 32 hex chars (~128 bits of entropy)

export function generateResetToken(): string {
  return randomBytes(RESET_TOKEN_BYTE_LENGTH).toString('hex');
}

export function getSessionExpirationDate(): Date {
  return new Date(Date.now() + SESSION_DURATION_MS);
}

export function getResetTokenExpirationDate(): Date {
  return new Date(Date.now() + RESET_TOKEN_DURATION_MS);
}
