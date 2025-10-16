import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Container,
  Nav,
  Navbar,
  Button,
  Spinner,
  Toast,
  ToastContainer,
  NavDropdown,
} from 'react-bootstrap';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BudgetImportModal } from './features/presupuestos/BudgetImportModal';
import { BudgetTable } from './features/presupuestos/BudgetTable';
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
import { TrainersView } from './features/recursos/TrainersView';
import { RoomsView } from './features/recursos/RoomsView';
import { MobileUnitsView } from './features/recursos/MobileUnitsView';
import { CertificateTemplatesView } from './features/recursos/CertificateTemplatesView';
import { CalendarView } from './features/calendar/CalendarView';
import { PublicSessionStudentsPage } from './public/PublicSessionStudentsPage';
import { CertificadosPage } from './features/certificados/CertificadosPage';

type NavView = {
  key: string;
  label: string;
  path?: string;
};

type NavItem = NavView & {
  children?: NavView[];
};

const NAVIGATION_ITEMS: NavItem[] = [
  { key: 'Presupuestos', label: 'Presupuestos', path: '/' },
  { key: 'Calendario', label: 'Calendario' },
  {
    key: 'Recursos',
    label: 'Recursos',
    children: [
      { key: 'Recursos/Formadores', label: 'Formadores / Bomberos' },
      { key: 'Recursos/Unidades', label: 'Unidades Móviles' },
      { key: 'Recursos/Salas', label: 'Salas' },
      { key: 'Recursos/Templates', label: 'Templates Certificados' },
    ],
  },
  { key: 'Certificados', label: 'Certificados', path: '/certificados' },
];

const VIEW_ITEMS: NavView[] = NAVIGATION_ITEMS.flatMap((item) =>
  item.children ? item.children : [item]
);

const PLACEHOLDER_VIEWS: NavView[] = VIEW_ITEMS.filter(
  (item) =>
    item.key !== 'Presupuestos' &&
    item.key !== 'Calendario' &&
    item.key !== 'Recursos/Formadores' &&
    item.key !== 'Recursos/Salas' &&
    item.key !== 'Recursos/Unidades' &&
    item.key !== 'Recursos/Templates' &&
    item.key !== 'Certificados'
);

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
  const [activeView, setActiveView] = useState('Presupuestos');
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
    if (location.pathname.startsWith('/certificados')) {
      setActiveView((current) => (current === 'Certificados' ? current : 'Certificados'));
    } else if (activeView === 'Certificados' && location.pathname === '/') {
      setActiveView('Presupuestos');
    }
  }, [activeView, location.pathname]);

  const isBudgetsView = activeView === 'Presupuestos';
  const isCalendarView = activeView === 'Calendario';
  const isTrainersView = activeView === 'Recursos/Formadores';
  const isRoomsView = activeView === 'Recursos/Salas';
  const isMobileUnitsView = activeView === 'Recursos/Unidades';
  const isCertificateTemplatesView = activeView === 'Recursos/Templates';
  const isCertificatesView = location.pathname.startsWith('/certificados');
  const activeViewLabel = useMemo(
    () => VIEW_ITEMS.find((item) => item.key === activeView)?.label ?? activeView,
    [activeView]
  );
  const placeholderViews = PLACEHOLDER_VIEWS;
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

  return (
    <div className="min-vh-100 d-flex flex-column">
      <Navbar bg="white" expand="lg" className="shadow-sm py-3">
        <Container fluid="xl" className="d-flex align-items-center gap-4">
          <Navbar.Brand href="#" className="d-flex align-items-center gap-3">
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
                  active={
                    !isCertificatesView && item.children.some((child) => child.key === activeView)
                  }
                >
                  {item.children.map((child) => (
                    <NavDropdown.Item
                      key={child.key}
                      active={!isCertificatesView && activeView === child.key}
                      onClick={(event) => {
                        event.preventDefault();
                        if (location.pathname !== '/') {
                          navigate('/');
                        }
                        setActiveView(child.key);
                      }}
                    >
                      {child.label}
                    </NavDropdown.Item>
                  ))}
                </NavDropdown>
              ) : (
                <Nav.Item key={item.key}>
                  <Nav.Link
                    active={
                      item.path
                        ? item.path === '/'
                          ? location.pathname === '/'
                          : location.pathname.startsWith(item.path)
                        : !isCertificatesView && activeView === item.key
                    }
                    onClick={() => {
                      if (item.path) {
                        setActiveView(item.key);
                        navigate(item.path);
                        return;
                      }

                      if (location.pathname !== '/') {
                        navigate('/');
                      }
                      setActiveView(item.key);
                    }}
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
          <Routes>
            <Route path="/certificados" element={<CertificadosPage />} />
            <Route
              path="*"
              element={
                isBudgetsView ? (
                  <div className="d-grid gap-4">
                    <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
                      <div>
                        <h1 className="h3 fw-bold mb-1">Presupuestos</h1>
                        <p className="text-muted mb-0">Sube tu presupuesto y planifica</p>
                      </div>
                      <div className="d-flex align-items-center gap-3">
                        {(importMutation.isPending || isRefreshing) && (
                          <Spinner animation="border" role="status" size="sm" />
                        )}
                        <Button size="lg" onClick={() => setShowImportModal(true)}>
                          Importar presupuesto
                        </Button>
                      </div>
                    </section>
                    <BudgetTable
                      budgets={budgets}
                      isLoading={budgetsQuery.isLoading}
                      isFetching={isRefreshing}
                      error={budgetsQuery.error ?? null}
                      onRetry={() => budgetsQuery.refetch()}
                      onSelect={handleSelectBudget}
                      onDelete={handleDeleteBudget}
                    />
                  </div>
                ) : isCalendarView ? (
                  <CalendarView onNotify={pushToast} onSessionOpen={handleOpenCalendarSession} />
                ) : isTrainersView ? (
                  <TrainersView onNotify={pushToast} />
                ) : isRoomsView ? (
                  <RoomsView onNotify={pushToast} />
                ) : isMobileUnitsView ? (
                  <MobileUnitsView onNotify={pushToast} />
                ) : isCertificateTemplatesView ? (
                  <CertificateTemplatesView onNotify={pushToast} />
                ) : (
                  <div className="bg-white rounded-4 shadow-sm p-5 text-center text-muted">
                    <h2 className="h4 fw-semibold mb-2">{activeViewLabel}</h2>
                    <p className="mb-0">
                      La sección {activeViewLabel} estará disponible próximamente. Mientras tanto, puedes seguir
                      trabajando en la pestaña de Presupuestos.
                    </p>
                    <div className="d-flex justify-content-center gap-2 mt-4">
                      {placeholderViews.map((view) => (
                        <Button key={view.key} variant="outline-secondary" size="sm" disabled>
                          {view.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                )
              }
            />
          </Routes>
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
