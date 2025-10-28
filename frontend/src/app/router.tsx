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
  allowedPaths: ReadonlySet<string>;
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
  allowedPaths,
}: AppRouterProps) {
  const guard = (path: string, element: JSX.Element) =>
    allowedPaths.has(path) ? element : <Navigate to={defaultRedirectPath} replace />;

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
          element={guard('/presupuestos', <Navigate to="/presupuestos/sinplanificar" replace />)}
        />
        <Route
          path="/presupuestos/sinplanificar"
          element={guard('/presupuestos/sinplanificar', <BudgetsPage {...budgetsPageProps} />)}
        />
        <Route
          path="/calendario/por_sesiones"
          element={guard(
            '/calendario/por_sesiones',
            createElement(PorSesionesPage, {
              ...porSesionesPageProps,
              key: 'calendar-sesiones',
            }),
          )}
        />
        <Route
          path="/calendario/por_unidad_movil"
          element={guard(
            '/calendario/por_unidad_movil',
            createElement(PorUnidadMovilPage, {
              ...porUnidadMovilPageProps,
              key: 'calendar-unidades',
            }),
          )}
        />
        <Route
          path="/calendario/por_formador"
          element={guard(
            '/calendario/por_formador',
            createElement(PorFormadorPage, {
              ...porFormadorPageProps,
              key: 'calendar-formadores',
            }),
          )}
        />
        <Route
          path="/recursos/formadores_bomberos"
          element={guard(
            '/recursos/formadores_bomberos',
            <FormadoresBomberosPage {...formadoresBomberosPageProps} />,
          )}
        />
        <Route
          path="/recursos/unidades_moviles"
          element={guard(
            '/recursos/unidades_moviles',
            <UnidadesMovilesPage {...unidadesMovilesPageProps} />,
          )}
        />
        <Route
          path="/recursos/salas"
          element={guard('/recursos/salas', <SalasPage {...salasPageProps} />)}
        />
        <Route
          path="/certificados/templates_certificados"
          element={guard(
            '/certificados/templates_certificados',
            <TemplatesCertificadosPage {...templatesCertificadosPageProps} />,
          )}
        />
        <Route
          path="/recursos/productos"
          element={guard('/recursos/productos', <ProductosPage {...productosPageProps} />)}
        />
        <Route
          path="/recursos/formacion_abierta"
          element={guard(
            '/recursos/formacion_abierta',
            <RecursosFormacionAbiertaPage {...recursosFormacionAbiertaPageProps} />,
          )}
        />
        <Route
          path="/formacion_abierta/cursos"
          element={guard(
            '/recursos/formacion_abierta',
            <Navigate to="/recursos/formacion_abierta" replace />,
          )}
        />
        <Route
          path="/informes/formacion"
          element={guard('/informes/formacion', <InformesFormacionPage />)}
        />
        <Route
          path="/informes/preventivo"
          element={guard('/informes/preventivo', <InformesPreventivoPage />)}
        />
        <Route
          path="/informes/simulacro"
          element={guard('/informes/simulacro', <InformesSimulacroPage />)}
        />
        <Route
          path="/informes/recurso_preventivo_ebro"
          element={guard(
            '/informes/recurso_preventivo_ebro',
            <InformesRecursoPreventivoEbroPage />,
          )}
        />
        <Route
          path="/certificados"
          element={guard('/certificados', <CertificadosPage {...certificadosPageProps} />)}
        />
        <Route
          path="/usuarios"
          element={guard('/usuarios', <UsersPage {...usersPageProps} />)}
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
