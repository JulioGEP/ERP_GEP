export const SESSION_COOKIE_NAME = 'erp_session';

export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  Admin: ['ALL'],
  Comercial: ['/perfil', '/presupuestos/sinplanificar', '/presupuestos/*'],
  Administracion: [
    '/perfil',
    '/presupuestos/sinplanificar',
    '/presupuestos/*',
    '/certificados',
    '/certificados/*',
  ],
  Logistica: [
    '/perfil',
    '/presupuestos/sinplanificar',
    '/presupuestos/*',
    '/recursos/unidades_moviles',
    '/recursos/salas',
  ],
  People: [
    '/perfil',
    '/presupuestos/sinplanificar',
    '/presupuestos/*',
    '/recursos/formadores_bomberos',
  ],
  Formador: ['/perfil'],
};

export const DEFAULT_ROUTE_ORDER = [
  '/presupuestos/sinplanificar',
  '/recursos/formadores_bomberos',
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
