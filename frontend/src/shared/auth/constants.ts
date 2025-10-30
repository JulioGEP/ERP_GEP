export const SESSION_COOKIE_NAME = 'erp_session';

export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  Admin: ['ALL'],
  Comercial: ['/presupuestos/sinplanificar', '/calendario/*'],
  Administracion: [
    '/presupuestos/sinplanificar',
    '/calendario/*',
    '/certificados',
    '/certificados/*',
  ],
  Logistica: [
    '/presupuestos/sinplanificar',
    '/calendario/*',
    '/recursos/unidades_moviles',
    '/recursos/salas',
  ],
  People: [
    '/presupuestos/sinplanificar',
    '/calendario/*',
    '/recursos/formadores_bomberos',
  ],
  Formador: [],
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
