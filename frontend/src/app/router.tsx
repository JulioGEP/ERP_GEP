import { createElement, lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useCurrentUser } from './auth/UserContext';
import type { UserRole } from '../types/user';
import { isRoleAllowedForPath, normalizeNavigationPath } from './rbac';
import type { BudgetsPageProps } from '../pages/presupuestos/BudgetsPage';
import type { PorSesionesPageProps } from '../pages/calendario/PorSesionesPage';
import type { PorUnidadMovilPageProps } from '../pages/calendario/PorUnidadMovilPage';
import type { PorFormadorPageProps } from '../pages/calendario/PorFormadorPage';
import type { FormadoresBomberosPageProps } from '../pages/recursos/FormadoresBomberosPage';
import type { UnidadesMovilesPageProps } from '../pages/recursos/UnidadesMovilesPage';
import type { SalasPageProps } from '../pages/recursos/SalasPage';
import type { TemplatesCertificadosPageProps } from '../pages/recursos/TemplatesCertificadosPage';
import type { ProductosPageProps } from '../pages/recursos/ProductosPage';
import type { CertificadosPageProps } from '../pages/certificados/CertificadosPage';
import type { RecursosFormacionAbiertaPageProps } from '../pages/recursos/FormacionAbiertaPage';

const BudgetsPage = lazy(() => import('../pages/presupuestos/BudgetsPage'));
const PorSesionesPage = lazy(() => import('../pages/calendario/PorSesionesPage'));
const PorUnidadMovilPage = lazy(() => import('../pages/calendario/PorUnidadMovilPage'));
const PorFormadorPage = lazy(() => import('../pages/calendario/PorFormadorPage'));
const FormadoresBomberosPage = lazy(() => import('../pages/recursos/FormadoresBomberosPage'));
const UnidadesMovilesPage = lazy(() => import('../pages/recursos/UnidadesMovilesPage'));
const SalasPage = lazy(() => import('../pages/recursos/SalasPage'));
const TemplatesCertificadosPage = lazy(() => import('../pages/recursos/TemplatesCertificadosPage'));
const ProductosPage = lazy(() => import('../pages/recursos/ProductosPage'));
const CertificadosPage = lazy(() => import('../pages/certificados/CertificadosPage'));
const RecursosFormacionAbiertaPage = lazy(
  () => import('../pages/recursos/FormacionAbiertaPage'),
);
const InformesFormacionPage = lazy(() => import('../pages/informes/FormacionReportPage'));
const InformesPreventivoPage = lazy(() => import('../pages/informes/PreventivoReportPage'));
const InformesSimulacroPage = lazy(() => import('../pages/informes/SimulacroReportPage'));
const InformesRecursoPreventivoEbroPage = lazy(
  () => import('../pages/informes/RecursoPreventivoEbroReportPage'),
);
const UsersPage = lazy(() => import('../pages/usuarios/UsersPage'));
const UnauthorizedPage = lazy(() => import('../pages/misc/UnauthorizedPage'));

function RequireRole({ path, children }: { path: string; children: JSX.Element }) {
  const { user } = useCurrentUser();
  const role: UserRole = (user?.role as UserRole) ?? 'formador';
  const normalizedPath = normalizeNavigationPath(path);
  if (isRoleAllowedForPath(role, normalizedPath)) {
    return children;
  }
  return <UnauthorizedPage />;
}

function withRoleGuard(path: string, element: JSX.Element) {
  return <RequireRole path={path}>{element}</RequireRole>;
}

type AppRouterProps = {
  budgetsPageProps: BudgetsPageProps;
  porSesionesPageProps: PorSesionesPageProps;
  porUnidadMovilPageProps: PorUnidadMovilPageProps;
  porFormadorPageProps: PorFormadorPageProps;
  formadoresBomberosPageProps: FormadoresBomberosPageProps;
  unidadesMovilesPageProps: UnidadesMovilesPageProps;
  salasPageProps: SalasPageProps;
  templatesCertificadosPageProps: TemplatesCertificadosPageProps;
  productosPageProps: ProductosPageProps;
  certificadosPageProps: CertificadosPageProps;
  recursosFormacionAbiertaPageProps: RecursosFormacionAbiertaPageProps;
  defaultRedirectPath: string;
  knownPaths: ReadonlySet<string>;
  activePathStorageKey: string;
};

export function AppRouter({
  budgetsPageProps,
  porSesionesPageProps,
  porUnidadMovilPageProps,
  porFormadorPageProps,
  formadoresBomberosPageProps,
  unidadesMovilesPageProps,
  salasPageProps,
  templatesCertificadosPageProps,
  productosPageProps,
  certificadosPageProps,
  recursosFormacionAbiertaPageProps,
  defaultRedirectPath,
  knownPaths,
  activePathStorageKey,
}: AppRouterProps) {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route
          path="/"
          element={
            <HomeRedirect
              defaultRedirectPath={defaultRedirectPath}
              knownPaths={knownPaths}
              activePathStorageKey={activePathStorageKey}
            />
          }
        />
        <Route
          path="/presupuestos"
          element={withRoleGuard('/presupuestos', <Navigate to="/presupuestos/sinplanificar" replace />)}
        />
        <Route
          path="/presupuestos/sinplanificar"
          element={withRoleGuard('/presupuestos/sinplanificar', <BudgetsPage {...budgetsPageProps} />)}
        />
        <Route
          path="/presupuestos/sintrabajar"
          element={withRoleGuard(
            '/presupuestos/sintrabajar',
            <BudgetsPage
              {...budgetsPageProps}
              title="Presupuestos · Sin trabajar"
              subtitle="Revisa el estado de validación de tus presupuestos"
              showFollowUpColumns
            />,
          )}
        />
        <Route
          path="/calendario/por_sesiones"
          element={withRoleGuard(
            '/calendario/por_sesiones',
            createElement(PorSesionesPage, { ...porSesionesPageProps, key: 'calendar-sesiones' }),
          )}
        />
        <Route
          path="/calendario/por_unidad_movil"
          element={withRoleGuard(
            '/calendario/por_unidad_movil',
            createElement(PorUnidadMovilPage, { ...porUnidadMovilPageProps, key: 'calendar-unidades' }),
          )}
        />
        <Route
          path="/calendario/por_formador"
          element={withRoleGuard(
            '/calendario/por_formador',
            createElement(PorFormadorPage, { ...porFormadorPageProps, key: 'calendar-formadores' }),
          )}
        />
        <Route
          path="/recursos/formadores_bomberos"
          element={withRoleGuard(
            '/recursos/formadores_bomberos',
            <FormadoresBomberosPage {...formadoresBomberosPageProps} />,
          )}
        />
        <Route
          path="/recursos/unidades_moviles"
          element={withRoleGuard(
            '/recursos/unidades_moviles',
            <UnidadesMovilesPage {...unidadesMovilesPageProps} />,
          )}
        />
        <Route
          path="/recursos/salas"
          element={withRoleGuard('/recursos/salas', <SalasPage {...salasPageProps} />)}
        />
        <Route
          path="/certificados/templates_certificados"
          element={withRoleGuard(
            '/certificados/templates_certificados',
            <TemplatesCertificadosPage {...templatesCertificadosPageProps} />,
          )}
        />
        <Route
          path="/recursos/productos"
          element={withRoleGuard('/recursos/productos', <ProductosPage {...productosPageProps} />)}
        />
        <Route
          path="/recursos/formacion_abierta"
          element={withRoleGuard(
            '/recursos/formacion_abierta',
            <RecursosFormacionAbiertaPage {...recursosFormacionAbiertaPageProps} />,
          )}
        />
        <Route
          path="/formacion_abierta/cursos"
          element={withRoleGuard(
            '/formacion_abierta/cursos',
            <Navigate to="/recursos/formacion_abierta" replace />,
          )}
        />
        <Route
          path="/informes/formacion"
          element={withRoleGuard('/informes/formacion', <InformesFormacionPage />)}
        />
        <Route
          path="/informes/preventivo"
          element={withRoleGuard('/informes/preventivo', <InformesPreventivoPage />)}
        />
        <Route
          path="/informes/simulacro"
          element={withRoleGuard('/informes/simulacro', <InformesSimulacroPage />)}
        />
        <Route
          path="/informes/recurso_preventivo_ebro"
          element={withRoleGuard(
            '/informes/recurso_preventivo_ebro',
            <InformesRecursoPreventivoEbroPage />,
          )}
        />
        <Route
          path="/certificados"
          element={withRoleGuard('/certificados', <CertificadosPage {...certificadosPageProps} />)}
        />
        <Route path="/usuarios" element={withRoleGuard('/usuarios', <UsersPage />)} />
        <Route path="/no-autorizado" element={<UnauthorizedPage />} />
        <Route path="*" element={<Navigate to={defaultRedirectPath} replace />} />
      </Routes>
    </Suspense>
  );
}

type HomeRedirectProps = {
  defaultRedirectPath: string;
  knownPaths: ReadonlySet<string>;
  activePathStorageKey: string;
};

function HomeRedirect({ defaultRedirectPath, knownPaths, activePathStorageKey }: HomeRedirectProps) {
  const preferredPath = (() => {
    if (typeof window === 'undefined') return defaultRedirectPath;
    try {
      const storedPath = window.localStorage.getItem(activePathStorageKey);
      if (storedPath) {
        const normalizedStoredPath = normalizeNavigationPath(storedPath);
        if (knownPaths.has(normalizedStoredPath)) {
          return storedPath;
        }
      }
    } catch (error) {
      console.warn('No se pudo leer la ruta activa almacenada', error);
    }
    return defaultRedirectPath;
  })();

  return <Navigate to={preferredPath} replace />;
}
