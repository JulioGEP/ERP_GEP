export const SESSION_COOKIE_NAME = 'erp_session';

export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  Admin: ['ALL'],
  Comercial: ['/presupuestos/todos', '/presupuestos/*', '/calendario/*', '/perfil'],
  Administracion: [
    '/presupuestos/todos',
    '/presupuestos/*',
    '/calendario/*',
    '/certificados',
    '/certificados/*',
    '/perfil',
  ],
  Logistica: [
    '/presupuestos/todos',
    '/presupuestos/*',
    '/calendario/*',
    '/recursos/unidades_moviles',
    '/recursos/salas',
    '/perfil',
  ],
  People: [
    '/presupuestos/todos',
    '/presupuestos/*',
    '/calendario/*',
    '/recursos/formadores_bomberos',
    '/perfil',
  ],
  Formador: ['/usuarios/trainer', '/perfil'],
};

export const DEFAULT_ROUTE_ORDER = [
  '/presupuestos/todos',
  '/recursos/formadores_bomberos',
  '/usuarios/trainer',
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
] as const;
