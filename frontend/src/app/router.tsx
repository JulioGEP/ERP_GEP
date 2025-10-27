import { createElement, lazy, Suspense, useMemo, type ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
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
import { useCurrentUser } from './CurrentUserContext';

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
const UnauthorizedPage = lazy(() => import('../pages/UnauthorizedPage'));

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
        <Route path="/presupuestos" element={<Navigate to="/presupuestos/sinplanificar" replace />} />
        <Route
          path="/presupuestos/sinplanificar"
          element={
            <RouteGuard path="/presupuestos/sinplanificar">
              <BudgetsPage {...budgetsPageProps} />
            </RouteGuard>
          }
        />
        <Route
          path="/calendario/por_sesiones"
          element={
            <RouteGuard path="/calendario/por_sesiones">
              {createElement(PorSesionesPage, {
                ...porSesionesPageProps,
                key: 'calendar-sesiones',
              })}
            </RouteGuard>
          }
        />
        <Route
          path="/calendario/por_unidad_movil"
          element={
            <RouteGuard path="/calendario/por_unidad_movil">
              {createElement(PorUnidadMovilPage, {
                ...porUnidadMovilPageProps,
                key: 'calendar-unidades',
              })}
            </RouteGuard>
          }
        />
        <Route
          path="/calendario/por_formador"
          element={
            <RouteGuard path="/calendario/por_formador">
              {createElement(PorFormadorPage, {
                ...porFormadorPageProps,
                key: 'calendar-formadores',
              })}
            </RouteGuard>
          }
        />
        <Route
          path="/recursos/formadores_bomberos"
          element={
            <RouteGuard path="/recursos/formadores_bomberos">
              <FormadoresBomberosPage {...formadoresBomberosPageProps} />
            </RouteGuard>
          }
        />
        <Route
          path="/recursos/unidades_moviles"
          element={
            <RouteGuard path="/recursos/unidades_moviles">
              <UnidadesMovilesPage {...unidadesMovilesPageProps} />
            </RouteGuard>
          }
        />
        <Route
          path="/recursos/salas"
          element={
            <RouteGuard path="/recursos/salas">
              <SalasPage {...salasPageProps} />
            </RouteGuard>
          }
        />
        <Route
          path="/certificados/templates_certificados"
          element={
            <RouteGuard path="/certificados/templates_certificados">
              <TemplatesCertificadosPage {...templatesCertificadosPageProps} />
            </RouteGuard>
          }
        />
        <Route
          path="/recursos/productos"
          element={
            <RouteGuard path="/recursos/productos">
              <ProductosPage {...productosPageProps} />
            </RouteGuard>
          }
        />
        <Route
          path="/recursos/formacion_abierta"
          element={
            <RouteGuard path="/recursos/formacion_abierta">
              <RecursosFormacionAbiertaPage {...recursosFormacionAbiertaPageProps} />
            </RouteGuard>
          }
        />
        <Route path="/formacion_abierta/cursos" element={<Navigate to="/recursos/formacion_abierta" replace />} />
        <Route
          path="/informes/formacion"
          element={
            <RouteGuard path="/informes/formacion">
              <InformesFormacionPage />
            </RouteGuard>
          }
        />
        <Route
          path="/informes/preventivo"
          element={
            <RouteGuard path="/informes/preventivo">
              <InformesPreventivoPage />
            </RouteGuard>
          }
        />
        <Route
          path="/informes/simulacro"
          element={
            <RouteGuard path="/informes/simulacro">
              <InformesSimulacroPage />
            </RouteGuard>
          }
        />
        <Route
          path="/informes/recurso_preventivo_ebro"
          element={
            <RouteGuard path="/informes/recurso_preventivo_ebro">
              <InformesRecursoPreventivoEbroPage />
            </RouteGuard>
          }
        />
        <Route
          path="/certificados"
          element={
            <RouteGuard path="/certificados">
              <CertificadosPage {...certificadosPageProps} />
            </RouteGuard>
          }
        />
        <Route
          path="/usuarios"
          element={
            <RouteGuard path="/usuarios">
              <UsersPage />
            </RouteGuard>
          }
        />
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
  const { authorization } = useCurrentUser();
  const fallbackPath = authorization.canAccessRoute(defaultRedirectPath)
    ? defaultRedirectPath
    : '/no-autorizado';

  const preferredPath = useMemo(() => {
    if (typeof window === 'undefined') return fallbackPath;
    try {
      const storedPath = window.localStorage.getItem(activePathStorageKey);
      if (
        storedPath &&
        knownPaths.has(storedPath) &&
        authorization.canAccessRoute(storedPath)
      ) {
        return storedPath;
      }
    } catch (error) {
      console.warn('No se pudo leer la ruta activa almacenada', error);
    }
    return fallbackPath;
  }, [activePathStorageKey, authorization, fallbackPath, knownPaths]);

  return <Navigate to={preferredPath} replace />;
}

type RouteGuardProps = {
  path: string;
  children: ReactElement;
};

function RouteGuard({ path, children }: RouteGuardProps) {
  const { authorization } = useCurrentUser();
  if (!authorization.canAccessRoute(path)) {
    return <UnauthorizedPage />;
  }
  return children;
}
