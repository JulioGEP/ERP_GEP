import type { UserRole } from '../types/user';

export const ALL_USER_ROLES: readonly UserRole[] = [
  'admin',
  'comercial',
  'administracion',
  'logistica',
  'people',
  'formador',
];

const ROUTE_ROLE_PERMISSIONS: Record<string, readonly UserRole[]> = {
  '/presupuestos': ['admin', 'comercial', 'administracion', 'logistica', 'people'],
  '/presupuestos/sinplanificar': ['admin', 'comercial', 'administracion', 'logistica', 'people'],
  '/calendario/por_sesiones': ['admin'],
  '/calendario/por_unidad_movil': ['admin'],
  '/calendario/por_formador': ['admin'],
  '/recursos/formadores_bomberos': ['admin', 'people'],
  '/recursos/unidades_moviles': ['admin', 'logistica'],
  '/recursos/salas': ['admin', 'logistica'],
  '/recursos/productos': ['admin'],
  '/recursos/formacion_abierta': ['admin'],
  '/certificados': ['admin', 'administracion'],
  '/certificados/templates_certificados': ['admin', 'administracion'],
  '/informes/formacion': ['admin'],
  '/informes/preventivo': ['admin'],
  '/informes/simulacro': ['admin'],
  '/informes/recurso_preventivo_ebro': ['admin'],
  '/usuarios': ['admin'],
  '/no-autorizado': ALL_USER_ROLES,
  '/formacion_abierta/cursos': ['admin'],
};

const ROUTE_ORDER: readonly string[] = Object.keys(ROUTE_ROLE_PERMISSIONS);

function normalizePath(path: string): string {
  if (!path) return '/';
  const trimmed = path.trim();
  if (!trimmed.length) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function getAllowedRolesForPath(path: string): readonly UserRole[] {
  const normalized = normalizePath(path);
  return ROUTE_ROLE_PERMISSIONS[normalized] ?? [];
}

export function isRoleAllowedForPath(role: UserRole, path: string): boolean {
  if (role === 'admin') return true;
  const normalizedPath = normalizePath(path);
  for (const route of ROUTE_ORDER) {
    const normalizedRoute = normalizePath(route);
    if (
      normalizedPath === normalizedRoute ||
      normalizedPath.startsWith(`${normalizedRoute}/`)
    ) {
      const roles = ROUTE_ROLE_PERMISSIONS[normalizedRoute];
      if (!roles || !roles.length) {
        return role === 'admin';
      }
      return roles.includes(role);
    }
  }
  return role === 'admin';
}

export function getAllowedPathsForRole(role: UserRole): string[] {
  const allowed: string[] = [];
  for (const route of ROUTE_ORDER) {
    const normalizedRoute = normalizePath(route);
    const roles = ROUTE_ROLE_PERMISSIONS[normalizedRoute];
    if (!roles || roles.includes(role) || role === 'admin') {
      if (!allowed.includes(normalizedRoute)) {
        allowed.push(normalizedRoute);
      }
    }
  }
  return allowed;
}

export function resolveDefaultPathForRole(role: UserRole): string {
  if (role === 'admin') {
    return '/presupuestos/sinplanificar';
  }

  const allowed = getAllowedPathsForRole(role);
  if (allowed.includes('/presupuestos/sinplanificar')) {
    return '/presupuestos/sinplanificar';
  }

  const filtered = allowed.filter((path) => path !== '/no-autorizado');
  if (filtered.length > 0) {
    return filtered[0];
  }

  return '/no-autorizado';
}

export function normalizeNavigationPath(path: string): string {
  return normalizePath(path);
}
