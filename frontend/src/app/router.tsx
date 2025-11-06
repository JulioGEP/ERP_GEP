import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { BudgetsPageProps } from '../pages/presupuestos/BudgetsPage';
import type { AllBudgetsPageProps } from '../pages/presupuestos/AllBudgetsPage';
import type { UnworkedBudgetsPageProps } from '../pages/presupuestos/UnworkedBudgetsPage';
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
import type { TrainerCalendarPageProps } from '../pages/usuarios/trainer/TrainerCalendarPage';
import { useAuth } from '../context/AuthContext';

const DashboardPage = lazy(() => import('../pages/dashboard/DashboardPage'));
const BudgetsPage = lazy(() => import('../pages/presupuestos/BudgetsPage'));
const AllBudgetsPage = lazy(() => import('../pages/presupuestos/AllBudgetsPage'));
const UnworkedBudgetsPage = lazy(() => import('../pages/presupuestos/UnworkedBudgetsPage'));
const PorSesionesPage = lazy(() => import('../pages/calendario/PorSesionesPage'));
const PorUnidadMovilPage = lazy(() => import('../pages/calendario/PorUnidadMovilPage'));
const PorFormadorPage = lazy(() => import('../pages/calendario/PorFormadorPage'));
const FormadoresBomberosPage = lazy(() => import('../pages/recursos/FormadoresBomberosPage'));
const UnidadesMovilesPage = lazy(() => import('../pages/recursos/UnidadesMovilesPage'));
const SalasPage = lazy(() => import('../pages/recursos/SalasPage'));
const TemplatesCertificadosPage = lazy(() => import('../pages/recursos/TemplatesCertificadosPage'));
const ProductosPage = lazy(() => import('../pages/recursos/ProductosPage'));
const CertificadosPage = lazy(() => import('../pages/certificados/CertificadosPage'));
const RecursosFormacionAbiertaPage = lazy(() => import('../pages/recursos/FormacionAbiertaPage'));
const InformesFormacionPage = lazy(() => import('../pages/informes/FormacionReportPage'));
const InformesPreventivoPage = lazy(() => import('../pages/informes/PreventivoReportPage'));
const InformesSimulacroPage = lazy(() => import('../pages/informes/SimulacroReportPage'));
const InformesRecursoPreventivoEbroPage = lazy(
  () => import('../pages/informes/RecursoPreventivoEbroReportPage'),
);
const UsersPage = lazy(() => import('../pages/usuarios/UsersPage'));
const ProfilePage = lazy(() => import('../pages/perfil/ProfilePage'));
const ForbiddenPage = lazy(() => import('../pages/system/ForbiddenPage'));
const TrainerDashboardPage = lazy(() => import('../pages/usuarios/trainer/TrainerDashboardPage'));
const TrainerCalendarPage = lazy(() => import('../pages/usuarios/trainer/TrainerCalendarPage'));
const TrainerAvailabilityPage = lazy(() => import('../pages/usuarios/trainer/TrainerAvailabilityPage'));
const TrainerSessionsPage = lazy(() => import('../pages/usuarios/trainer/TrainerSessionsPage'));
const HorasFormadoresPage = lazy(() => import('../pages/direccion/HorasFormadoresPage'));

type AppRouterProps = {
  budgetsPageProps: BudgetsPageProps;
  allBudgetsPageProps: AllBudgetsPageProps;
  unworkedBudgetsPageProps: UnworkedBudgetsPageProps;
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
  trainerCalendarPageProps?: TrainerCalendarPageProps;
  defaultRedirectPath: string;
  knownPaths: ReadonlySet<string>;
  activePathStorageKey: string;
};

export function AppRouter({
  budgetsPageProps,
  allBudgetsPageProps,
  unworkedBudgetsPageProps,
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
  trainerCalendarPageProps,
  defaultRedirectPath,
  knownPaths,
  activePathStorageKey,
}: AppRouterProps) {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route
          path="/usuarios/trainer/dashboard"
          element={
            <GuardedRoute
              path="/usuarios/trainer/dashboard"
              roles={['Formador']}
              element={<TrainerDashboardPage />}
            />
          }
        />

        <Route
          path="/usuarios/trainer/calendario"
          element={
            <GuardedRoute
              path="/usuarios/trainer/calendario"
              roles={['Formador']}
              element={
                <TrainerCalendarPage
                  {...(trainerCalendarPageProps as TrainerCalendarPageProps | undefined)}
                />
              }
            />
          }
        />

        <Route
          path="/usuarios/trainer/disponibilidad"
          element={
            <GuardedRoute
              path="/usuarios/trainer/disponibilidad"
              roles={['Formador']}
              element={<TrainerAvailabilityPage />}
            />
          }
        />

        <Route
          path="/usuarios/trainer/sesiones"
          element={
            <GuardedRoute
              path="/usuarios/trainer/sesiones"
              roles={['Formador']}
              element={<TrainerSessionsPage />}
            />
          }
        />

        <Route
          path="/dashboard"
          element={<GuardedRoute path="/dashboard" element={<DashboardPage />} />}
        />

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

        <Route path="/presupuestos" element={<Navigate to="/presupuestos/todos" replace />} />

        <Route
          path="/presupuestos/todos"
          element={
            <GuardedRoute
              path="/presupuestos/todos"
              element={<AllBudgetsPage {...allBudgetsPageProps} />}
            />
          }
        />

        <Route
          path="/presupuestos/sintrabajar"
          element={
            <GuardedRoute
              path="/presupuestos/sintrabajar"
              element={<UnworkedBudgetsPage {...unworkedBudgetsPageProps} />}
            />
          }
        />

        <Route
          path="/presupuestos/sinplanificar"
          element={
            <GuardedRoute
              path="/presupuestos/sinplanificar"
              element={<BudgetsPage {...budgetsPageProps} />}
            />
          }
        />

        <Route
          path="/calendario/por_sesiones"
          element={
            <GuardedRoute
              path="/calendario/por_sesiones"
              element={
                // Cast para evitar TS2698 cuando el tipo importado es unknown
                <PorSesionesPage
                  {...(porSesionesPageProps as PorSesionesPageProps & Record<string, unknown>)}
                  key="calendar-sesiones"
                />
              }
            />
          }
        />

        <Route
          path="/calendario/por_unidad_movil"
          element={
            <GuardedRoute
              path="/calendario/por_unidad_movil"
              element={
                <PorUnidadMovilPage
                  {...(porUnidadMovilPageProps as PorUnidadMovilPageProps & Record<string, unknown>)}
                  key="calendar-unidades"
                />
              }
            />
          }
        />

        <Route
          path="/calendario/por_formador"
          element={
            <GuardedRoute
              path="/calendario/por_formador"
              element={
                <PorFormadorPage
                  {...(porFormadorPageProps as PorFormadorPageProps & Record<string, unknown>)}
                  key="calendar-formadores"
                />
              }
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
        <Route path="/recursos/trainer" element={<Navigate to="/recursos/formadores_bomberos" replace />} />
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
          element={
            <GuardedRoute
              path="/informes/recurso_preventivo_ebro"
              element={<InformesRecursoPreventivoEbroPage />}
            />
          }
        />

        <Route
          path="/certificados"
          element={<GuardedRoute path="/certificados" element={<CertificadosPage {...(certificadosPageProps as CertificadosPageProps & Record<string, unknown>)} />} />}
        />
        <Route
          path="/usuarios"
          element={<GuardedRoute path="/usuarios" element={<UsersPage {...usersPageProps} />} />}
        />

        <Route
          path="/direccion/horas_formadores"
          element={
            <GuardedRoute
              path="/direccion/horas_formadores"
              roles={['Admin']}
              element={<HorasFormadoresPage />}
            />
          }
        />

        <Route path="/perfil" element={<GuardedRoute path="/perfil" element={<ProfilePage />} />} />

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
  roles?: readonly string[];
};

function GuardedRoute({ path, element, roles }: GuardedRouteProps) {
  const { isAuthenticated, hasPermission, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (roles && roles.length) {
    const role = user?.role?.trim();
    if (!role || !roles.includes(role)) {
      return <ForbiddenPage />;
    }
  }

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
