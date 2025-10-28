import type { UserRole } from '../../types/user';

const ALL_APP_PATHS = [
  '/',
  '/presupuestos',
  '/presupuestos/sinplanificar',
  '/calendario/por_sesiones',
  '/calendario/por_unidad_movil',
  '/calendario/por_formador',
  '/recursos/formadores_bomberos',
  '/recursos/unidades_moviles',
  '/recursos/salas',
  '/recursos/productos',
  '/recursos/formacion_abierta',
  '/certificados',
  '/certificados/templates_certificados',
  '/informes/formacion',
  '/informes/preventivo',
  '/informes/simulacro',
  '/informes/recurso_preventivo_ebro',
  '/usuarios',
] as const;

const ROLE_ALLOWED_PATHS: Record<UserRole, ReadonlyArray<string>> = {
  admin: ALL_APP_PATHS,
  comercial: ['/', '/presupuestos', '/presupuestos/sinplanificar'],
  administracion: [
    '/',
    '/presupuestos',
    '/presupuestos/sinplanificar',
    '/certificados',
    '/certificados/templates_certificados',
  ],
  logistica: [
    '/',
    '/presupuestos',
    '/presupuestos/sinplanificar',
    '/recursos/unidades_moviles',
    '/recursos/salas',
  ],
  people: [
    '/',
    '/presupuestos',
    '/presupuestos/sinplanificar',
    '/recursos/formadores_bomberos',
  ],
  formador: ['/', '/presupuestos/sinplanificar'],
};

const ROLE_DEFAULT_PATH: Record<UserRole, string> = {
  admin: '/presupuestos/sinplanificar',
  comercial: '/presupuestos/sinplanificar',
  administracion: '/presupuestos/sinplanificar',
  logistica: '/presupuestos/sinplanificar',
  people: '/presupuestos/sinplanificar',
  formador: '/presupuestos/sinplanificar',
};

export function getAllowedPaths(role: UserRole | null): ReadonlySet<string> {
  if (!role) {
    return new Set(['/presupuestos/sinplanificar']);
  }
  const paths = ROLE_ALLOWED_PATHS[role] ?? ['/presupuestos/sinplanificar'];
  return new Set(paths);
}

export function getDefaultPath(role: UserRole | null): string {
  if (!role) {
    return '/presupuestos/sinplanificar';
  }
  return ROLE_DEFAULT_PATH[role] ?? '/presupuestos/sinplanificar';
}

export function canImportBudgets(role: UserRole | null): boolean {
  if (!role) return false;
  if (role === 'logistica') return false;
  if (role === 'formador') return false;
  return true;
}

export function canManageUsers(role: UserRole | null): boolean {
  return role === 'admin';
}

export function isPathAllowed(role: UserRole | null, path: string): boolean {
  const allowed = getAllowedPaths(role);
  if (allowed.has(path)) {
    return true;
  }
  // Paths may include legacy routes that redirect
  if (path.endsWith('/') && allowed.has(path.slice(0, -1))) {
    return true;
  }
  return false;
}

export function getAllAppPaths(): readonly string[] {
  return ALL_APP_PATHS;
}
