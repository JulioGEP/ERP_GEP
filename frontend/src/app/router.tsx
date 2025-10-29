import { createElement, lazy, Suspense } from 'react';
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
import type { UsersPageProps } from '../pages/usuarios/UsersPage';
import { useAuth } from '../context/AuthContext'; // ⬅️ ruta corregida

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
const ForbiddenPage = lazy(() => import('../pages/system/ForbiddenPage'));

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
  usersPageProps: UsersPageProps;
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
  usersPageProps,
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
          element={<GuardedRoute path="/presupuestos/sinplanificar" element={<BudgetsPage {...budgetsPageProps} />} />}
        />

        <Route
          path="/calendario/por_sesiones"
          element={
            <GuardedRoute
              path="/calendario/por_sesiones"
              element={createElement(PorSesionesPage, { ...porSesionesPageProps, key: 'calendar-sesiones' })}
            />
          }
        />
        <Route
          path="/calendario/por_unidad_movil"
          element={
            <GuardedRoute
              path="/calendario/por_unidad_movil"
              element={createElement(PorUnidadMovilPage, {
                ...porUnidadMovilPageProps,
                key: 'calendar-unidades',
              })}
            />
          }
        />
        <Route
          path="/calendario/por_formador"
          element={
            <GuardedRoute
              path="/calendario/por_formador"
              element={createElement(PorFormadorPage, { ...porFormadorPageProps, key: 'calendar-formadores' })}
            />
          }
        />

        <Route
          path="/recursos/formadores_bomberos"
          element={
            <GuardedRoute
              path="/recursos/formadores_bomberos"
              element={<FormadoresBomberosPage {...formadoresBomberosPageProps} />}
            />
          }
        />
        <Route
          path="/recursos/unidades_moviles"
          element={
            <GuardedRoute
              path="/recursos/unidades_moviles"
              element={<UnidadesMovilesPage {...unidadesMovilesPageProps} />}
            />
          }
        />
        <Route
          path="/recursos/salas"
          element={<GuardedRoute path="/recursos/salas" element={<SalasPage {...salasPageProps} />} />}
        />
        <Route
          path="/certificados/templates_certificados"
          element={
            <GuardedRoute
              path="/certificados/templates_certificados"
              element={<TemplatesCertificadosPage {...templatesCertificadosPageProps} />}
            />
          }
        />
        <Route
          path="/recursos/productos"
          element={<GuardedRoute path="/recursos/productos" element={<ProductosPage {...productosPageProps} />} />}
        />
        <Route
          path="/recursos/formacion_abierta"
          element={
            <GuardedRoute
              path="/recursos/formacion_abierta"
              element={<RecursosFormacionAbiertaPage {...recursosFormacionAbiertaPageProps} />}
            />
          }
        />
        <Route path="/formacion_abierta/cursos" element={<Navigate to="/recursos/formacion_abierta" replace />} />

        <Route
          path="/informes/formacion"
          element={<GuardedRoute path="/informes/formacion" element={<InformesFormacionPage />} />}
        />
        <Route
          path="/informes/preventivo"
          element={<GuardedRoute path="/informes/preventivo" element={<InformesPreventivoPage />} />}
        />
        <Route
          path="/informes/simulacro"
          element={<GuardedRoute path="/informes/simulacro" element={<InformesSimulacroPage />} />}
        />
        <Route
          path="/informes/recurso_preventivo_ebro"
          element={<GuardedRoute path="/informes/recurso_preventivo_ebro" element={<InformesRecursoPreventivoEbroPage />} />}
        />

        <Route
          path="/certificados"
          element={<GuardedRoute path="/certificados" element={<CertificadosPage {...certificadosPageProps} />} />}
        />
        <Route
          path="/usuarios"
          element={<GuardedRoute path="/usuarios" element={<UsersPage {...usersPageProps} />} />}
        />

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

type GuardedRouteProps = {
  path: string;
  element: JSX.Element;
};

function GuardedRoute({ path, element }: GuardedRouteProps) {
  const { isAuthenticated, hasPermission } = useAuth();

  // No autenticado → a /login
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Autenticado pero sin permiso → 403
  if (!hasPermission(path)) {
    return <ForbiddenPage />;
  }

  return element;
}

function HomeRedirect({ defaultRedirectPath, knownPaths, activePathStorageKey }: HomeRedirectProps) {
  const preferredPath = (() => {
    if (typeof window === 'undefined') return defaultRedirectPath;
    try {
      const storedPath = window.localStorage.getItem(activePathStorageKey);
      if (storedPath && knownPaths.has(storedPath)) {
        return storedPath;
      }
    } catch (error) {
      console.warn('No se pudo leer la ruta activa almacenada', error);
    }
    return defaultRedirectPath;
  })();

  return <Navigate to={preferredPath} replace />;
}
