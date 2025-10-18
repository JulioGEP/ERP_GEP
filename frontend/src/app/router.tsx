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
        <Route path="/presupuestos" element={<BudgetsPage {...budgetsPageProps} />} />
        <Route
          path="/calendario/por_sesiones"
          element={createElement(PorSesionesPage, { ...porSesionesPageProps, key: 'calendar-sesiones' })}
        />
        <Route
          path="/calendario/por_unidad_movil"
          element={createElement(PorUnidadMovilPage, { ...porUnidadMovilPageProps, key: 'calendar-unidades' })}
        />
        <Route
          path="/calendario/por_formador"
          element={createElement(PorFormadorPage, { ...porFormadorPageProps, key: 'calendar-formadores' })}
        />
        <Route
          path="/recursos/formadores_bomberos"
          element={<FormadoresBomberosPage {...formadoresBomberosPageProps} />}
        />
        <Route
          path="/recursos/unidades_moviles"
          element={<UnidadesMovilesPage {...unidadesMovilesPageProps} />}
        />
        <Route path="/recursos/salas" element={<SalasPage {...salasPageProps} />} />
        <Route
          path="/recursos/templates_certificados"
          element={<TemplatesCertificadosPage {...templatesCertificadosPageProps} />}
        />
        <Route path="/recursos/productos" element={<ProductosPage {...productosPageProps} />} />
        <Route path="/certificados" element={<CertificadosPage {...certificadosPageProps} />} />
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
