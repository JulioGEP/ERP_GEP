import { DEFAULT_ROUTE_ORDER, ROLE_PERMISSIONS } from './constants';

export type PermissionList = readonly string[];

export function normalizePath(path: string): string {
  if (!path) return '';
  if (path === '/') return '/';
  const trimmed = path.trim();
  if (!trimmed.length) return '';
  const normalized = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  return normalized || '/';
}

export function hasPermission(path: string, permissions: PermissionList): boolean {
  if (!permissions.length) return false;
  if (permissions.includes('ALL')) return true;

  const normalizedPath = normalizePath(path);
  if (!normalizedPath.length) return false;

  return permissions.some((permission) => {
    const normalizedPermission = normalizePath(permission);
    if (!normalizedPermission.length) return false;
    if (normalizedPermission === normalizedPath) {
      return true;
    }
    if (normalizedPermission.endsWith('/*')) {
      const base = normalizedPermission.slice(0, -2);
      return normalizedPath === base || normalizedPath.startsWith(`${base}/`);
    }
    return false;
  });
}

export function getPermissionsForRole(role: string | null | undefined): PermissionList {
  if (!role) return [];
  const normalized = role.trim().toLowerCase();
  if (!normalized.length) return [];

  for (const [roleName, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    if (roleName.trim().toLowerCase() === normalized) {
      return permissions;
    }
  }

  return [];
}

export function computeDefaultPath(permissions: PermissionList): string {
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
