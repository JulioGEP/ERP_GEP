import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { BudgetsPageProps } from '../pages/presupuestos/BudgetsPage';
import type { AllBudgetsPageProps } from '../pages/presupuestos/AllBudgetsPage';
import type { UnworkedBudgetsPageProps } from '../pages/presupuestos/UnworkedBudgetsPage';
import type { UnplannedSessionsPageProps } from '../pages/presupuestos/UnplannedSessionsPage';
import type {
  MaterialsBoardPageProps,
  MaterialsBudgetsPageProps,
  MaterialsPendingProductsPageProps,
  MaterialsOrdersPageProps,
} from '../pages/materiales';
import type { PorSesionesPageProps } from '../pages/calendario/PorSesionesPage';
import type { PorUnidadMovilPageProps } from '../pages/calendario/PorUnidadMovilPage';
import type { PorFormadorPageProps } from '../pages/calendario/PorFormadorPage';
import type { PorEmpresaPageProps } from '../pages/calendario/PorEmpresaPage';
import type { PlanificacionPageProps } from '../pages/calendario/PlanificacionPage';
import type { FormadoresBomberosPageProps } from '../pages/recursos/FormadoresBomberosPage';
import type { UnidadesMovilesPageProps } from '../pages/recursos/UnidadesMovilesPage';
import type { SalasPageProps } from '../pages/recursos/SalasPage';
import type { TemplatesCertificadosPageProps } from '../pages/recursos/TemplatesCertificadosPage';
import type { ProductosPageProps } from '../pages/recursos/ProductosPage';
import type { ProductsHoldedPageProps } from '../pages/recursos/ProductsHoldedPage';
import type { StockPageProps } from '../pages/recursos/StockPage';
import type { ProveedoresPageProps } from '../pages/recursos/ProveedoresPage';
import type { MailchimpPageProps } from '../pages/recursos/MailchimpPage';
import type { CertificadosPageProps } from '../pages/certificados/CertificadosPage';
import type { RecursosFormacionAbiertaPageProps } from '../pages/recursos/FormacionAbiertaPage';
import type { ConfirmacionesPageProps } from '../pages/recursos/ConfirmacionesPage';
import type { UsersPageProps } from '../pages/usuarios/UsersPage';
import type { TrainerCalendarPageProps } from '../pages/usuarios/trainer/TrainerCalendarPage';
import { useAuth } from '../context/AuthContext';
import { fetchTrainers } from '../features/recursos/api';

const DashboardPage = lazy(() => import('../pages/dashboard/DashboardPage'));
const BudgetsPage = lazy(() => import('../pages/presupuestos/BudgetsPage'));
const AllBudgetsPage = lazy(() => import('../pages/presupuestos/AllBudgetsPage'));
const UnworkedBudgetsPage = lazy(() => import('../pages/presupuestos/UnworkedBudgetsPage'));
const UnplannedSessionsPage = lazy(() => import('../pages/presupuestos/UnplannedSessionsPage'));
const PosDocumentsPage = lazy(() => import('../pages/presupuestos/PosDocumentsPage'));
const MaterialsBudgetsPage = lazy(() => import('../pages/materiales/MaterialsBudgetsPage'));
const MaterialsBoardPage = lazy(() => import('../pages/materiales/MaterialsBoardPage'));
const MaterialsPendingProductsPage = lazy(
  () => import('../pages/materiales/MaterialsPendingProductsPage'),
);
const MaterialsOrdersPage = lazy(() => import('../pages/materiales/MaterialsOrdersPage'));
const PorSesionesPage = lazy(() => import('../pages/calendario/PorSesionesPage'));
const PorUnidadMovilPage = lazy(() => import('../pages/calendario/PorUnidadMovilPage'));
const PorFormadorPage = lazy(() => import('../pages/calendario/PorFormadorPage'));
const PlanificacionPage = lazy(() => import('../pages/calendario/PlanificacionPage'));
const PorEmpresaPage = lazy(() => import('../pages/calendario/PorEmpresaPage'));
const DisponibilidadPage = lazy(() => import('../pages/calendario/DisponibilidadPage'));
const FormadoresBomberosPage = lazy(() => import('../pages/recursos/FormadoresBomberosPage'));
const UnidadesMovilesPage = lazy(() => import('../pages/recursos/UnidadesMovilesPage'));
const SalasPage = lazy(() => import('../pages/recursos/SalasPage'));
const TemplatesCertificadosPage = lazy(() => import('../pages/recursos/TemplatesCertificadosPage'));
const ProductosPage = lazy(() => import('../pages/recursos/ProductosPage'));
const ProductsHoldedPage = lazy(() => import('../pages/recursos/ProductsHoldedPage'));
const StockPage = lazy(() => import('../pages/recursos/StockPage'));
const SessionImportPage = lazy(() => import('../pages/recursos/SessionImportPage'));
const BulkBudgetImportPage = lazy(() => import('../pages/recursos/BulkBudgetImportPage'));
const ProveedoresPage = lazy(() => import('../pages/recursos/ProveedoresPage'));
const MailchimpPage = lazy(() => import('../pages/recursos/MailchimpPage'));
const ConfirmacionesPage = lazy(() => import('../pages/recursos/ConfirmacionesPage'));
const CertificadosPage = lazy(() => import('../pages/certificados/CertificadosPage'));
const IssuedCertificatesPage = lazy(() => import('../pages/certificados/IssuedCertificatesPage'));
const RecursosFormacionAbiertaPage = lazy(() => import('../pages/recursos/FormacionAbiertaPage'));
const InformesFormacionPage = lazy(() => import('../pages/informes/FormacionReportPage'));
const InformesPreventivoPage = lazy(() => import('../pages/informes/PreventivoReportPage'));
const InformesSimulacroPage = lazy(() => import('../pages/informes/SimulacroReportPage'));
const InformesRecursoPreventivoEbroPage = lazy(
  () => import('../pages/informes/RecursoPreventivoEbroReportPage'),
);
const InformesListadoPage = lazy(() => import('../pages/informes/InformesListadoPage'));
const UsersPage = lazy(() => import('../pages/usuarios/UsersPage'));
const TrainerDashboardPage = lazy(() => import('../pages/usuarios/trainer/TrainerDashboardPage'));
const TrainerPendingSessionsPage = lazy(() => import('../pages/usuarios/trainer/TrainerPendingSessionsPage'));
const TrainerSessionsPage = lazy(() => import('../pages/usuarios/trainer/TrainerSessionsPage'));
const TrainerCalendarPage = lazy(() => import('../pages/usuarios/trainer/TrainerCalendarPage'));
const TrainerAvailabilityPage = lazy(() => import('../pages/usuarios/trainer/TrainerAvailabilityPage'));
const TrainerReportsListPage = lazy(
  () => import('../pages/usuarios/trainer/informes/TrainerReportsListPage'),
);
const TrainerReportsIndexPage = lazy(
  () => import('../pages/usuarios/trainer/informes/TrainerReportsIndexPage'),
);
const TrainerReportsFormacionPage = lazy(
  () => import('../pages/usuarios/trainer/informes/TrainerReportsFormacionPage'),
);
const TrainerReportsPreventivoPage = lazy(
  () => import('../pages/usuarios/trainer/informes/TrainerReportsPreventivoPage'),
);
const TrainerReportsSimulacroPage = lazy(
  () => import('../pages/usuarios/trainer/informes/TrainerReportsSimulacroPage'),
);
const TrainerReportsRecursoPreventivoEbroPage = lazy(
  () => import('../pages/usuarios/trainer/informes/TrainerReportsRecursoPreventivoEbroPage'),
);
const UsersVacationsPage = lazy(() => import('../pages/usuarios/UsersVacationsPage'));
const ProfilePage = lazy(() => import('../pages/perfil/ProfilePage'));
const ControlHorasPage = lazy(() => import('../pages/perfil/ControlHorasPage'));
const ControlHorarioUserPage = lazy(() => import('../pages/controlHorario/ControlHorarioPage'));
const ForbiddenPage = lazy(() => import('../pages/system/ForbiddenPage'));
const HorasFormadoresPage = lazy(() => import('../pages/reporting/HorasFormadoresPage'));
const ControlHorasFormadoresPage = lazy(() => import('../pages/reporting/ControlHorasFormadoresPage'));
const ControlHorarioPage = lazy(() => import('../pages/reporting/ControlHorarioPage'));
const CostesExtraPage = lazy(() => import('../pages/reporting/CostesExtraPage'));
const LogsPage = lazy(() => import('../pages/reporting/LogsPage'));
const ComparativaDashboardPage = lazy(() => import('../pages/reporting/ComparativaDashboardPage'));
const WebhooksPipedrivePage = lazy(() => import('../pages/reporting/WebhooksPipedrivePage'));
const NominasFijosPage = lazy(() => import('../pages/reporting/NominasFijosPage'));
const NominasFijosDiscontinuosPage = lazy(
  () => import('../pages/reporting/NominasFijosDiscontinuosPage'),
);
const SlackPage = lazy(() => import('../pages/reporting/SlackPage'));

type AppRouterProps = {
  budgetsPageProps: BudgetsPageProps;
  allBudgetsPageProps: AllBudgetsPageProps;
  unworkedBudgetsPageProps: UnworkedBudgetsPageProps;
  unplannedSessionsPageProps: UnplannedSessionsPageProps;
  materialsBoardPageProps: MaterialsBoardPageProps;
  materialsBudgetsPageProps: MaterialsBudgetsPageProps;
  materialsPendingProductsPageProps: MaterialsPendingProductsPageProps;
  materialsOrdersPageProps: MaterialsOrdersPageProps;
  porSesionesPageProps: PorSesionesPageProps;
  porUnidadMovilPageProps: PorUnidadMovilPageProps;
  porFormadorPageProps: PorFormadorPageProps;
  planificacionPageProps: PlanificacionPageProps;
  porEmpresaPageProps: PorEmpresaPageProps;
  formadoresBomberosPageProps: FormadoresBomberosPageProps;
  unidadesMovilesPageProps: UnidadesMovilesPageProps;
  salasPageProps: SalasPageProps;
  proveedoresPageProps: ProveedoresPageProps;
  mailchimpPageProps: MailchimpPageProps;
  templatesCertificadosPageProps: TemplatesCertificadosPageProps;
  productosPageProps: ProductosPageProps;
  productsHoldedPageProps: ProductsHoldedPageProps;
  stockPageProps: StockPageProps;
  recursosConfirmacionesPageProps: ConfirmacionesPageProps;
  certificadosPageProps: CertificadosPageProps;
  recursosFormacionAbiertaPageProps: RecursosFormacionAbiertaPageProps;
  usersPageProps: UsersPageProps;
  trainerCalendarPageProps: TrainerCalendarPageProps;
  defaultRedirectPath: string;
  knownPaths: ReadonlySet<string>;
  activePathStorageKey: string;
};

export function AppRouter({
  budgetsPageProps,
  allBudgetsPageProps,
  unworkedBudgetsPageProps,
  unplannedSessionsPageProps,
  materialsBoardPageProps,
  materialsBudgetsPageProps,
  materialsPendingProductsPageProps,
  materialsOrdersPageProps,
  porSesionesPageProps,
  porUnidadMovilPageProps,
  porFormadorPageProps,
  planificacionPageProps,
  porEmpresaPageProps,
  formadoresBomberosPageProps,
  unidadesMovilesPageProps,
  salasPageProps,
  proveedoresPageProps,
  mailchimpPageProps,
  templatesCertificadosPageProps,
  productosPageProps,
  productsHoldedPageProps,
  stockPageProps,
  recursosConfirmacionesPageProps,
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
          path="/presupuestos/sinformador"
          element={
            <GuardedRoute
              path="/presupuestos/sinformador"
              element={<BudgetsPage {...budgetsPageProps} />}
            />
          }
        />

        <Route
          path="/presupuestos/sin_agendar"
          element={
            <GuardedRoute
              path="/presupuestos/sin_agendar"
              element={<UnplannedSessionsPage {...unplannedSessionsPageProps} />}
            />
          }
        />

        <Route
          path="/presupuestos/pos"
          element={<GuardedRoute path="/presupuestos/pos" element={<PosDocumentsPage />} />}
        />

        <Route
          path="/materiales/tablero"
          element={
            <GuardedRoute
              path="/materiales/tablero"
              element={<MaterialsBoardPage {...materialsBoardPageProps} />}
            />
          }
        />

        <Route path="/materiales" element={<Navigate to="/materiales/todos" replace />} />

        <Route
          path="/materiales/todos"
          element={<GuardedRoute path="/materiales/todos" element={<MaterialsBudgetsPage {...materialsBudgetsPageProps} />} />}
        />

        <Route
          path="/materiales/pendientes"
          element={
            <GuardedRoute
              path="/materiales/pendientes"
              element={<MaterialsPendingProductsPage {...materialsPendingProductsPageProps} />}
            />
          }
        />

        <Route
          path="/materiales/pedidos"
          element={
            <GuardedRoute
              path="/materiales/pedidos"
              element={<MaterialsOrdersPage {...materialsOrdersPageProps} />}
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
          path="/calendario/planificacion"
          element={
            <GuardedRoute
              path="/calendario/planificacion"
              element={
                <PlanificacionPage
                  {...(planificacionPageProps as PlanificacionPageProps & Record<string, unknown>)}
                  key="calendar-planificacion"
                />
              }
            />
          }
        />

        <Route
          path="/calendario/disponibilidad"
          element={<GuardedRoute path="/calendario/disponibilidad" element={<DisponibilidadPage />} />}
        />

        <Route
          path="/calendario/por_empresa"
          element={
            <GuardedRoute
              path="/calendario/por_empresa"
              element={
                <PorEmpresaPage
                  {...(porEmpresaPageProps as PorEmpresaPageProps & Record<string, unknown>)}
                  key="calendar-empresas"
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
          path="/recursos/proveedores"
          element={
            <GuardedRoute
              path="/recursos/proveedores"
              element={<ProveedoresPage {...proveedoresPageProps} />}
            />
          }
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
          path="/recursos/formaciones"
          element={<GuardedRoute path="/recursos/formaciones" element={<ProductosPage {...productosPageProps} />} />}
        />
        <Route
          path="/recursos/products_holded"
          element={
            <GuardedRoute
              path="/recursos/products_holded"
              element={<ProductsHoldedPage {...productsHoldedPageProps} />}
            />
          }
        />
        <Route path="/recursos/productos" element={<Navigate to="/recursos/formaciones" replace />} />
        <Route
          path="/recursos/stock"
          element={<GuardedRoute path="/recursos/stock" element={<StockPage {...stockPageProps} />} />}
        />
        <Route
          path="/recursos/mailchimp"
          element={<GuardedRoute path="/recursos/mailchimp" element={<MailchimpPage {...mailchimpPageProps} />} />}
        />
        <Route
          path="/recursos/importar_sesion"
          element={<GuardedRoute path="/recursos/importar_sesion" element={<SessionImportPage />} />}
        />
        <Route
          path="/recursos/importar_en_bucle"
          element={<GuardedRoute path="/recursos/importar_en_bucle" element={<BulkBudgetImportPage />} />}
        />
        <Route
          path="/recursos/confirmaciones"
          element={
            <GuardedRoute
              path="/recursos/confirmaciones"
              element={<ConfirmacionesPage {...recursosConfirmacionesPageProps} />}
            />
          }
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
          path="/informes/listado"
          element={<GuardedRoute path="/informes/listado" element={<InformesListadoPage />} />}
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
          path="/certificados_emitidos"
          element={<GuardedRoute path="/certificados_emitidos" element={<IssuedCertificatesPage />} />}
        />
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
          path="/usuarios/trainer/pendientes"
          element={
            <GuardedRoute
              path="/usuarios/trainer/pendientes"
              roles={['Formador']}
              element={<TrainerPendingSessionsPage />}
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
          path="/usuarios/trainer/calendario"
          element={
            <GuardedRoute
              path="/usuarios/trainer/calendario"
              roles={['Formador']}
              element={<TrainerCalendarPage {...trainerCalendarPageProps} />}
            />
          }
        />
        <Route
          path="/usuarios/trainer/informes"
          element={
            <GuardedRoute
              path="/usuarios/trainer/informes"
              roles={['Formador']}
              element={<TrainerReportsIndexPage />}
            />
          }
        />
        <Route
          path="/usuarios/trainer/informes/informes"
          element={
            <GuardedRoute
              path="/usuarios/trainer/informes/informes"
              roles={['Formador']}
              element={<TrainerReportsListPage />}
            />
          }
        />
        <Route
          path="/usuarios/trainer/informes/formacion"
          element={
            <GuardedRoute
              path="/usuarios/trainer/informes/formacion"
              roles={['Formador']}
              element={<TrainerReportsFormacionPage />}
            />
          }
        />
        <Route
          path="/usuarios/trainer/informes/preventivo"
          element={
            <GuardedRoute
              path="/usuarios/trainer/informes/preventivo"
              roles={['Formador']}
              element={<TrainerReportsPreventivoPage />}
            />
          }
        />
        <Route
          path="/usuarios/trainer/informes/simulacro"
          element={
            <GuardedRoute
              path="/usuarios/trainer/informes/simulacro"
              roles={['Formador']}
              element={<TrainerReportsSimulacroPage />}
            />
          }
        />
        <Route
          path="/usuarios/trainer/informes/recurso_preventivo_ebro"
          element={
            <GuardedRoute
              path="/usuarios/trainer/informes/recurso_preventivo_ebro"
              roles={['Formador']}
              element={<TrainerReportsRecursoPreventivoEbroPage />}
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
          path="/usuarios/nominas_fijos"
          element={
            <GuardedRoute
              path="/usuarios/nominas_fijos"
              roles={['Admin', 'Administracion', 'People']}
              element={<NominasFijosPage />}
            />
          }
        />

        <Route
          path="/usuarios/nominas_formadores_fijos"
          element={
            <GuardedRoute
              path="/usuarios/nominas_formadores_fijos"
              roles={['Admin', 'Administracion', 'People']}
              element={<NominasFijosDiscontinuosPage />}
            />
          }
        />

        <Route
          path="/usuarios/vacaciones"
          element={<GuardedRoute path="/usuarios/vacaciones" element={<UsersVacationsPage />} />}
        />

        <Route
          path="/usuarios"
          element={<GuardedRoute path="/usuarios" element={<UsersPage {...usersPageProps} />} />}
        />

        <Route
          path="/usuarios/nominas_formadores_externos"
          element={
            <GuardedRoute
              path="/usuarios/nominas_formadores_externos"
              roles={['Admin']}
              element={<HorasFormadoresPage />}
            />
          }
        />

        <Route
          path="/reporting/comparativa"
          element={
            <GuardedRoute
              path="/reporting/comparativa"
              roles={['Admin']}
              element={<ComparativaDashboardPage />}
            />
          }
        />

        <Route
          path="/reporting/webhooks_pipedrive"
          element={
            <GuardedRoute
              path="/reporting/webhooks_pipedrive"
              roles={['Admin']}
              element={<WebhooksPipedrivePage />}
            />
          }
        />

        <Route
          path="/usuarios/costes_extra"
          element={
            <GuardedRoute
              path="/usuarios/costes_extra"
              roles={['Admin']}
              element={<CostesExtraPage />}
            />
          }
        />

        <Route path="/reporting/costes_extra" element={<Navigate to="/usuarios/costes_extra" replace />} />


        <Route
          path="/reporting/slack"
          element={
            <GuardedRoute
              path="/reporting/slack"
              roles={['Admin']}
              element={<SlackPage />}
            />
          }
        />

        <Route
          path="/reporting/logs"
          element={
            <GuardedRoute
              path="/reporting/logs"
              roles={['Admin']}
              element={<LogsPage />}
            />
          }
        />

        <Route
          path="/reporting/control_horario_fijos"
          element={
            <GuardedRoute
              path="/reporting/control_horario_fijos"
              roles={['Admin']}
              element={<ControlHorarioPage />}
            />
          }
        />
        <Route
          path="/reporting/control_horario_discontinuos"
          element={
            <GuardedRoute
              path="/reporting/control_horario_discontinuos"
              roles={['Admin']}
              element={<ControlHorasFormadoresPage />}
            />
          }
        />

        <Route
          path="/reporting/control_horario"
          element={<Navigate to="/reporting/control_horario_fijos" replace />}
        />
        <Route
          path="/reporting/control_horas_formadores"
          element={<Navigate to="/reporting/control_horario_discontinuos" replace />}
        />

        <Route path="/perfil" element={<GuardedRoute path="/perfil" element={<ProfilePage />} />} />
        <Route
          path="/control_horario"
          element={<GuardedRoute path="/control_horario" element={<ControlHorarioGuard />} />}
        />
        <Route
          path="/perfil/control_horas"
          element={
            <GuardedRoute
              path="/perfil/control_horas"
              roles={['Formador']}
              element={<ControlHorasGuard />}
            />
          }
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
  roles?: readonly string[];
};

function GuardedRoute({ path, element, roles }: GuardedRouteProps) {
  const { isAuthenticated, hasPermission, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (roles && roles.length > 0) {
    const currentRole = user?.role?.trim();
    if (!currentRole || !roles.includes(currentRole)) {
      return <ForbiddenPage />;
    }
  }

  if (!hasPermission(path)) {
    return <ForbiddenPage />;
  }

  return element;
}

function ControlHorasGuard() {
  const { user } = useAuth();
  const trainerId = user?.trainerId ?? null;
  const isFormador = user?.role?.trim().toLowerCase() === 'formador';

  const trainerDetailsQuery = useQuery({
    queryKey: ['trainer-details', 'control-horas', trainerId],
    queryFn: async () => {
      if (!trainerId) return null;
      const trainers = await fetchTrainers();
      return trainers.find((trainer) => trainer.trainer_id === trainerId) ?? null;
    },
    enabled: isFormador && Boolean(trainerId),
    staleTime: 5 * 60 * 1000,
  });

  const isFixedTrainer = trainerDetailsQuery.data?.contrato_fijo === true;

  if (trainerDetailsQuery.isLoading) {
    return <div className="text-muted">Cargando información del formador…</div>;
  }

  if (isFixedTrainer) {
    return <ForbiddenPage />;
  }

  return <ControlHorasPage />;
}

function ControlHorarioGuard() {
  const { user } = useAuth();
  const trainerId = user?.trainerId ?? null;
  const isFormador = user?.role?.trim().toLowerCase() === 'formador';

  const trainerDetailsQuery = useQuery({
    queryKey: ['trainer-details', 'control-horario', trainerId],
    queryFn: async () => {
      if (!trainerId) return null;
      const trainers = await fetchTrainers();
      return trainers.find((trainer) => trainer.trainer_id === trainerId) ?? null;
    },
    enabled: isFormador && Boolean(trainerId),
    staleTime: 5 * 60 * 1000,
  });

  if (isFormador) {
    if (trainerDetailsQuery.isLoading) {
      return <div className="text-muted">Cargando información del formador…</div>;
    }

    if (!trainerDetailsQuery.data?.contrato_fijo) {
      return <ForbiddenPage />;
    }
  }

  return <ControlHorarioUserPage />;
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
