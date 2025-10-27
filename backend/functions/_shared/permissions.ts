export const USER_ROLES = [
  'comercial',
  'administracion',
  'logistica',
  'admin',
  'people',
  'formador',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export type RolePermissions = {
  /** Lista explícita de rutas accesibles. */
  routes: string[];
  /** Permite acceso a cualquier ruta (se usa para admin). */
  allowAllRoutes?: boolean;
  /** Acciones específicas disponibles para el rol. */
  actions: Record<string, boolean>;
  /** Permite todas las acciones (se usa para admin). */
  allowAllActions?: boolean;
};

export const ROLE_PERMISSIONS: Record<UserRole, RolePermissions> = {
  comercial: {
    routes: ['/presupuestos', '/presupuestos/sinplanificar'],
    actions: {
      'budgets:import': true,
      'users:manage': false,
    },
  },
  administracion: {
    routes: [
      '/presupuestos',
      '/presupuestos/sinplanificar',
      '/certificados',
      '/certificados/templates_certificados',
    ],
    actions: {
      'budgets:import': true,
      'users:manage': false,
    },
  },
  logistica: {
    routes: [
      '/presupuestos',
      '/presupuestos/sinplanificar',
      '/recursos/unidades_moviles',
      '/recursos/salas',
    ],
    actions: {
      'budgets:import': false,
      'users:manage': false,
    },
  },
  admin: {
    routes: ['*'],
    allowAllRoutes: true,
    allowAllActions: true,
    actions: {
      'budgets:import': true,
      'users:manage': true,
    },
  },
  people: {
    routes: [
      '/presupuestos',
      '/presupuestos/sinplanificar',
      '/recursos/formadores_bomberos',
    ],
    actions: {
      'budgets:import': true,
      'users:manage': false,
    },
  },
  formador: {
    routes: [],
    actions: {
      'budgets:import': false,
      'users:manage': false,
    },
  },
};

export function isValidUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && USER_ROLES.includes(value as UserRole);
}

export function canRoleAccessRoute(role: UserRole, path: string): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  if (permissions.allowAllRoutes) return true;
  const normalizedPath = normalizeRoute(path);
  return permissions.routes.some((route) => normalizeRoute(route) === normalizedPath);
}

export function canRolePerformAction(role: UserRole, action: string): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  if (permissions.allowAllActions) return true;
  return permissions.actions[action] === true;
}

function normalizeRoute(value: string): string {
  const text = value.trim();
  if (!text.length) return '';
  return text.endsWith('/') && text !== '/' ? text.slice(0, -1) : text;
}
