import { useCallback, useEffect, useState } from 'react';
import { Container, Nav, Navbar, Toast, ToastContainer, NavDropdown } from 'react-bootstrap';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BudgetImportModal } from './features/presupuestos/BudgetImportModal';
import { BudgetDetailModal } from './features/presupuestos/BudgetDetailModal';
import { ProductCommentWindow } from './features/presupuestos/ProductCommentWindow';
import type { ProductCommentPayload } from './features/presupuestos/ProductCommentWindow';
import {
  ApiError,
  fetchDealsWithoutSessions,
  importDeal,
  deleteDeal,
} from './features/presupuestos/api';
import { normalizeImportDealResult } from './features/presupuestos/importDealUtils';
import type { CalendarSession } from './features/calendar/api';
import type { DealSummary } from './types/deal';
import logo from './assets/gep-group-logo.png';
import { PublicSessionStudentsPage } from './public/PublicSessionStudentsPage';
import { AppRouter } from './app/router';
import type { BudgetsPageProps } from './pages/presupuestos/BudgetsPage';
import type { PorSesionesPageProps } from './pages/calendario/PorSesionesPage';
import type { PorUnidadMovilPageProps } from './pages/calendario/PorUnidadMovilPage';
import type { PorFormadorPageProps } from './pages/calendario/PorFormadorPage';
import type { FormadoresBomberosPageProps } from './pages/recursos/FormadoresBomberosPage';
import type { UnidadesMovilesPageProps } from './pages/recursos/UnidadesMovilesPage';
import type { SalasPageProps } from './pages/recursos/SalasPage';
import type { TemplatesCertificadosPageProps } from './pages/recursos/TemplatesCertificadosPage';
import type { ProductosPageProps } from './pages/recursos/ProductosPage';
import type { CertificadosPageProps } from './pages/certificados/CertificadosPage';

const ACTIVE_PATH_STORAGE_KEY = 'erp-gep-active-path';

type NavChild = {
  key: string;
  label: string;
  path: string;
};

type NavItem = {
  key: string;
  label: string;
  path?: string;
  children?: NavChild[];
};

const NAVIGATION_ITEMS: NavItem[] = [
  { key: 'Presupuestos', label: 'Presupuestos', path: '/presupuestos' },
  {
    key: 'Calendario',
    label: 'Calendario',
    children: [
      { key: 'Calendario/Sesiones', label: 'Por sesiones', path: '/calendario/por_sesiones' },
      { key: 'Calendario/Formadores', label: 'Por formador', path: '/calendario/por_formador' },
      { key: 'Calendario/Unidades', label: 'Por unidad móvil', path: '/calendario/por_unidad_movil' },
    ],
  },
  {
    key: 'Recursos',
    label: 'Recursos',
    children: [
      { key: 'Recursos/Formadores', label: 'Formadores / Bomberos', path: '/recursos/formadores_bomberos' },
      { key: 'Recursos/Unidades', label: 'Unidades Móviles', path: '/recursos/unidades_moviles' },
      { key: 'Recursos/Salas', label: 'Salas', path: '/recursos/salas' },
      { key: 'Recursos/Templates', label: 'Templates Certificados', path: '/recursos/templates_certificados' },
      { key: 'Recursos/Productos', label: 'Productos', path: '/recursos/productos' },
    ],
  },
  { key: 'Certificados', label: 'Certificados', path: '/certificados' },
];

const KNOWN_APP_PATHS = new Set(
  NAVIGATION_ITEMS.flatMap((item) => [item.path, ...(item.children?.map((child) => child.path) ?? [])])
    .filter((path): path is string => Boolean(path))
);

const DEFAULT_REDIRECT_PATH = '/presupuestos';

type ToastMessage = {
  id: string;
  variant: 'success' | 'danger' | 'info';
  message: string;
};

export default function App() {
  const isPublicStudentsPage =
    typeof window !== 'undefined' && /\/public\/sesiones\/[^/]+\/alumnos/i.test(window.location.pathname);

  if (isPublicStudentsPage) {
    return <PublicSessionStudentsPage />;
  }

  const location = useLocation();
  const navigate = useNavigate();

  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(null);
  const [selectedBudgetSummary, setSelectedBudgetSummary] = useState<DealSummary | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [productComment, setProductComment] = useState<ProductCommentPayload | null>(null);

  const queryClient = useQueryClient();

  useEffect(() => {
    if (!selectedBudgetId) {
      setProductComment(null);
    }
  }, [selectedBudgetId]);

  const budgetsQuery = useQuery({
    queryKey: ['deals', 'noSessions'],
    queryFn: fetchDealsWithoutSessions,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    retry: 0,
    staleTime: Infinity
  });

  const pushToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const importMutation = useMutation({
    mutationFn: (dealId: string) => importDeal(dealId),
    onSuccess: (payload) => {
      const { deal } = normalizeImportDealResult(payload);

      if (deal) {
        setSelectedBudgetSummary(deal as DealSummary);
        // Acepta dealId o deal_id y fuerza string|null
        setSelectedBudgetId(
          ((deal as any).dealId ?? (deal as any).deal_id ?? null) as string | null,
        );
      } else {
        setSelectedBudgetSummary(null);
        setSelectedBudgetId(null);
      }

      pushToast({ variant: 'success', message: 'Presupuesto importado' });
      setShowImportModal(false);
      queryClient.invalidateQueries({ queryKey: ['deals', 'noSessions'] });
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : null;
      const code = apiError?.code ?? 'UNKNOWN_ERROR';
      const message =
        apiError?.message ?? 'No se ha podido importar el presupuesto. Inténtalo de nuevo más tarde.';
      pushToast({ variant: 'danger', message: `No se pudo importar. [${code}] ${message}` });
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (KNOWN_APP_PATHS.has(location.pathname)) {
      try {
        window.localStorage.setItem(ACTIVE_PATH_STORAGE_KEY, location.pathname);
      } catch (error) {
        console.warn('No se pudo guardar la ruta activa', error);
      }
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!location.pathname.startsWith('/presupuestos')) {
      setShowImportModal(false);
    }
  }, [location.pathname]);

  const budgets = budgetsQuery.data ?? [];
  const isRefreshing = budgetsQuery.isFetching && !budgetsQuery.isLoading;

  const deleteDealMutation = useMutation({
    mutationFn: (dealId: string) => deleteDeal(dealId),
    onSuccess: (_, dealId) => {
      setSelectedBudgetId((current) => (current === dealId ? null : current));
      setSelectedBudgetSummary((current) => {
        if (!current) return current;
        const currentId = current.dealId ?? current.deal_id;
        return currentId === dealId ? null : current;
      });
      pushToast({ variant: 'success', message: 'Presupuesto eliminado' });
      queryClient.invalidateQueries({ queryKey: ['deals', 'noSessions'] });
    },
    onError: (error: unknown) => {
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
          ? error.message
          : 'No se pudo eliminar el presupuesto.';
      pushToast({ variant: 'danger', message });
    },
  });

  const handleSelectBudget = useCallback((budget: DealSummary) => {
    setSelectedBudgetSummary(budget);
    // 👇 asegura string | null
    setSelectedBudgetId(budget.dealId ?? null);
  }, []);

  const handleDeleteBudget = useCallback(
    async (budget: DealSummary) => {
      const rawId = budget.dealId ?? budget.deal_id;
      const id = typeof rawId === 'string' ? rawId.trim() : '';
      if (!id) {
        throw new Error('No se pudo determinar el identificador del presupuesto.');
      }

      await deleteDealMutation.mutateAsync(id);
    },
    [deleteDealMutation]
  );

  const handleCloseDetail = useCallback(() => {
    setSelectedBudgetSummary(null);
    setSelectedBudgetId(null);
  }, []);

  const handleShowProductComment = useCallback((payload: ProductCommentPayload) => {
    setProductComment(payload);
  }, []);

  const handleCloseProductComment = useCallback(() => {
    setProductComment(null);
  }, []);

  const handleOpenCalendarSession = useCallback(
    (session: CalendarSession) => {
      const id = session.dealId?.trim();
      if (!id) {
        pushToast({ variant: 'danger', message: 'No se pudo determinar el identificador del presupuesto.' });
        return;
      }

      const dealTitle = session.dealTitle?.trim() ?? '';
      const sessionTitle = session.title.trim();
      const summaryTitle = dealTitle.length
        ? dealTitle
        : sessionTitle.length
        ? sessionTitle
        : `Presupuesto ${id}`;

      const productId = session.productId.trim();
      const productName = session.productName?.trim() ?? '';
      const productCode = session.productCode?.trim() ?? '';

      const hasProductInfo = Boolean(productId.length || productName.length || productCode.length);

      const productNames = productName.length
        ? [productName]
        : productCode.length
        ? [productCode]
        : undefined;

      const summaryFromSession: DealSummary = {
        deal_id: id,
        dealId: id,
        title: summaryTitle,
        training_address: session.dealAddress,
        organization: null,
        person: null,
        products: hasProductInfo
          ? [
              {
                id: productId.length ? productId : null,
                deal_id: id,
                name: productName.length ? productName : null,
                code: productCode.length ? productCode : null,
                comments: null,
                quantity: null,
                price: null,
                type: null,
                hours: null,
              },
            ]
          : undefined,
        productNames,
      };

      setSelectedBudgetSummary(summaryFromSession);
      setSelectedBudgetId(id);
    },
    [pushToast],
  );

  const budgetsPageProps: BudgetsPageProps = {
    budgets,
    isLoading: budgetsQuery.isLoading,
    isFetching: isRefreshing,
    error: budgetsQuery.error ?? null,
    onRetry: () => budgetsQuery.refetch(),
    onSelect: handleSelectBudget,
    onDelete: handleDeleteBudget,
    onOpenImportModal: () => setShowImportModal(true),
    isImporting: importMutation.isPending,
  };

  const calendarSessionsPageProps: PorSesionesPageProps = {
    onNotify: pushToast,
    onSessionOpen: handleOpenCalendarSession,
  };

  const calendarUnitsPageProps: PorUnidadMovilPageProps = {
    onNotify: pushToast,
    onSessionOpen: handleOpenCalendarSession,
  };

  const calendarTrainersPageProps: PorFormadorPageProps = {
    onNotify: pushToast,
    onSessionOpen: handleOpenCalendarSession,
  };

  const formadoresBomberosPageProps: FormadoresBomberosPageProps = {
    onNotify: pushToast,
  };

  const unidadesMovilesPageProps: UnidadesMovilesPageProps = {
    onNotify: pushToast,
  };

  const salasPageProps: SalasPageProps = {
    onNotify: pushToast,
  };

  const templatesCertificadosPageProps: TemplatesCertificadosPageProps = {
    onNotify: pushToast,
  };

  const productosPageProps: ProductosPageProps = {
    onNotify: pushToast,
  };

  const certificadosPageProps: CertificadosPageProps = {};

  return (
    <div className="min-vh-100 d-flex flex-column">
      <Navbar bg="white" expand="lg" className="shadow-sm py-3">
        <Container fluid="xl" className="d-flex align-items-center gap-4">
          <Navbar.Brand
            href="#"
            className="d-flex align-items-center gap-3"
            onClick={(event) => {
              event.preventDefault();
              navigate('/presupuestos');
            }}
          >
            <img src={logo} height={64} alt="GEP Group" />
            <div>
              <span className="d-block fw-semibold text-uppercase small text-muted">GEP Group</span>
              <span className="d-block fw-bold" style={{ color: 'var(--color-red)' }}>
                Planificador
              </span>
            </div>
          </Navbar.Brand>
          <Nav className="ms-auto gap-3">
            {NAVIGATION_ITEMS.map((item) =>
              item.children ? (
                <NavDropdown
                  key={item.key}
                  title={<span className="text-uppercase">{item.label}</span>}
                  id={`nav-${item.key}`}
                  active={item.children.some((child) => location.pathname.startsWith(child.path))}
                >
                  {item.children.map((child) => (
                    <NavDropdown.Item
                      key={child.key}
                      as={NavLink}
                      to={child.path}
                      className="text-uppercase"
                    >
                      {child.label}
                    </NavDropdown.Item>
                  ))}
                </NavDropdown>
              ) : (
                <Nav.Item key={item.key}>
                  <Nav.Link
                    as={NavLink}
                    to={item.path ?? '#'}
                    className="text-uppercase"
                  >
                    {item.label}
                  </Nav.Link>
                </Nav.Item>
              )
            )}
          </Nav>
        </Container>
      </Navbar>

      <main className="flex-grow-1 py-5">
        <Container fluid="xl">
          <AppRouter
            budgetsPageProps={budgetsPageProps}
            porSesionesPageProps={calendarSessionsPageProps}
            porUnidadMovilPageProps={calendarUnitsPageProps}
            porFormadorPageProps={calendarTrainersPageProps}
            formadoresBomberosPageProps={formadoresBomberosPageProps}
            unidadesMovilesPageProps={unidadesMovilesPageProps}
            salasPageProps={salasPageProps}
            templatesCertificadosPageProps={templatesCertificadosPageProps}
            productosPageProps={productosPageProps}
            certificadosPageProps={certificadosPageProps}
            defaultRedirectPath={DEFAULT_REDIRECT_PATH}
            knownPaths={KNOWN_APP_PATHS}
            activePathStorageKey={ACTIVE_PATH_STORAGE_KEY}
          />
        </Container>
      </main>

      <footer className="py-4 bg-white mt-auto border-top">
        <Container fluid="xl" className="text-muted small d-flex justify-content-between align-items-center">
          <span>© {new Date().getFullYear()} GEP Group</span>
          <span>ERP colaborativo para planificación de formaciones</span>
        </Container>
      </footer>

      <BudgetImportModal
        show={showImportModal}
        isLoading={importMutation.isPending}
        onClose={() => setShowImportModal(false)}
        onSubmit={(dealId) => importMutation.mutate(dealId)}
      />

      <BudgetDetailModal
        dealId={selectedBudgetId}
        summary={selectedBudgetSummary}
        onClose={handleCloseDetail}
        onShowProductComment={handleShowProductComment}
        onNotify={pushToast}
      />

      <ProductCommentWindow
        show={!!productComment}
        productName={productComment?.productName ?? null}
        comment={productComment?.comment ?? null}
        onClose={handleCloseProductComment}
      />

      <ToastContainer position="bottom-end" className="p-3">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            bg={toast.variant}
            onClose={() => removeToast(toast.id)}
            delay={5000}
            autohide
          >
            <Toast.Body className="text-white">{toast.message}</Toast.Body>
          </Toast>
        ))}
      </ToastContainer>
    </div>
  );
}
