import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
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
import { ProductsView } from './features/recursos/ProductsView';
import { CalendarView } from './features/calendar/CalendarView';
import { PublicSessionStudentsPage } from './public/PublicSessionStudentsPage';
import { CertificadosPage } from './features/certificados/CertificadosPage';

const ACTIVE_VIEW_STORAGE_KEY = 'erp-gep-active-view';
const DEFAULT_VIEW_KEY = 'Presupuestos';

type NavView = {
  key: string;
  label: string;
  path: string;
};

type NavItem = {
  key: string;
  label: string;
  path: string;
  children?: NavView[];
};

const NAVIGATION_ITEMS: NavItem[] = [
  { key: 'Presupuestos', label: 'Presupuestos', path: '/' },
  {
    key: 'Calendario',
    label: 'Calendario',
    path: '/calendario/sesiones',
    children: [
      { key: 'Calendario/Sesiones', label: 'Por sesiones', path: '/calendario/sesiones' },
      { key: 'Calendario/Formadores', label: 'Por formador', path: '/calendario/formadores' },
      { key: 'Calendario/Unidades', label: 'Por unidad móvil', path: '/calendario/unidades' },
    ],
  },
  {
    key: 'Recursos',
    label: 'Recursos',
    path: '/recursos/formadores',
    children: [
      { key: 'Recursos/Formadores', label: 'Formadores / Bomberos', path: '/recursos/formadores' },
      { key: 'Recursos/Unidades', label: 'Unidades Móviles', path: '/recursos/unidades' },
      { key: 'Recursos/Salas', label: 'Salas', path: '/recursos/salas' },
      { key: 'Recursos/Templates', label: 'Templates Certificados', path: '/recursos/templates' },
      { key: 'Recursos/Productos', label: 'Productos', path: '/recursos/productos' },
    ],
  },
  { key: 'Certificados', label: 'Certificados', path: '/certificados' },
];

const VIEW_ITEMS: NavView[] = NAVIGATION_ITEMS.flatMap((item) =>
  item.children ? item.children : [item]
);

const VIEW_KEY_TO_PATH = new Map(VIEW_ITEMS.map((view) => [view.key, view.path]));
const SORTED_VIEWS_BY_PATH_LENGTH = VIEW_ITEMS.filter((view) => view.path !== '/')
  .slice()
  .sort((a, b) => b.path.length - a.path.length);

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') {
    return '/';
  }
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed.length ? trimmed : '/';
}

function getActiveViewKeyFromPath(pathname: string): string {
  const normalized = normalizePathname(pathname);
  for (const view of SORTED_VIEWS_BY_PATH_LENGTH) {
    if (normalized.startsWith(view.path)) {
      return view.key;
    }
  }
  return DEFAULT_VIEW_KEY;
}

function normalizeStoredViewKey(value: string | null): string {
  if (!value) {
    return DEFAULT_VIEW_KEY;
  }
  const trimmed = value.trim();
  if (!trimmed.length) {
    return DEFAULT_VIEW_KEY;
  }
  if (trimmed === 'Calendario') {
    return 'Calendario/Sesiones';
  }
  if (VIEW_KEY_TO_PATH.has(trimmed)) {
    return trimmed;
  }
  return DEFAULT_VIEW_KEY;
}

function readStoredViewKey(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_VIEW_KEY;
  }
  try {
    const stored = window.localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY);
    return normalizeStoredViewKey(stored);
  } catch (error) {
    console.warn('No se pudo leer la vista activa almacenada', error);
    return DEFAULT_VIEW_KEY;
  }
}

type ToastMessage = {
  id: string;
  variant: 'success' | 'danger' | 'info';
  message: string;
};

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();

  const initialStoredViewRef = useRef<string>(readStoredViewKey());
  const skipInitialStoreRef = useRef(true);

  const isPublicStudentsPage = useMemo(
    () => /^\/public\/sesiones\/[^/]+\/alumnos/i.test(location.pathname),
    [location.pathname]
  );

  if (isPublicStudentsPage) {
    return <PublicSessionStudentsPage />;
  }

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

  useEffect(() => {
    const storedKey = initialStoredViewRef.current;
    const storedPath = VIEW_KEY_TO_PATH.get(storedKey);
    const normalizedCurrentPath = normalizePathname(location.pathname);
    if (
      normalizedCurrentPath === '/' &&
      storedPath &&
      storedPath !== '/' &&
      storedPath !== normalizedCurrentPath
    ) {
      navigate(storedPath, { replace: true });
    }
  }, [location.pathname, navigate]);

  const activeViewKey = useMemo(
    () => getActiveViewKeyFromPath(location.pathname),
    [location.pathname]
  );

  useEffect(() => {
    const normalizedCurrentPath = normalizePathname(location.pathname);
    if (
      skipInitialStoreRef.current &&
      normalizedCurrentPath === '/' &&
      initialStoredViewRef.current !== DEFAULT_VIEW_KEY
    ) {
      return;
    }
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, activeViewKey);
      } catch (error) {
        console.warn('No se pudo guardar la vista activa', error);
      }
    }
    initialStoredViewRef.current = activeViewKey;
    skipInitialStoreRef.current = false;
  }, [activeViewKey, location.pathname]);

  const budgetsQuery = useQuery({
    queryKey: ['deals', 'noSessions'],
    queryFn: fetchDealsWithoutSessions,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    retry: 0,
    staleTime: Infinity,
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
    },
  });

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
    [deleteDealMutation],
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

  const handleNavigate = useCallback(
    (path: string) => {
      const normalizedTarget = normalizePathname(path);
      const normalizedCurrent = normalizePathname(location.pathname);
      if (normalizedTarget !== normalizedCurrent) {
        navigate(path);
      }
    },
    [location.pathname, navigate],
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
                  active={item.children.some((child) => child.key === activeViewKey)}
                >
                  {item.children.map((child) => (
                    <NavDropdown.Item
                      key={child.key}
                      active={activeViewKey === child.key}
                      onClick={(event) => {
                        event.preventDefault();
                        handleNavigate(child.path);
                      }}
                    >
                      {child.label}
                    </NavDropdown.Item>
                  ))}
                </NavDropdown>
              ) : (
                <Nav.Item key={item.key}>
                  <Nav.Link
                    active={activeViewKey === item.key}
                    onClick={(event) => {
                      event.preventDefault();
                      handleNavigate(item.path);
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
            <Route
              path="/"
              element={
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
              }
            />
            <Route path="/presupuestos" element={<Navigate to="/" replace />} />
            <Route
              path="/calendario/sesiones"
              element={
                <CalendarView
                  key="calendar-sesiones"
                  title="Calendario · Por sesiones"
                  mode="sessions"
                  onNotify={pushToast}
                  onSessionOpen={handleOpenCalendarSession}
                />
              }
            />
            <Route
              path="/calendario/formadores"
              element={
                <CalendarView
                  key="calendar-formadores"
                  title="Calendario · Por formador"
                  mode="trainers"
                  initialView="month"
                  onNotify={pushToast}
                  onSessionOpen={handleOpenCalendarSession}
                />
              }
            />
            <Route
              path="/calendario/unidades"
              element={
                <CalendarView
                  key="calendar-unidades"
                  title="Calendario · Por unidad móvil"
                  mode="units"
                  initialView="month"
                  onNotify={pushToast}
                  onSessionOpen={handleOpenCalendarSession}
                />
              }
            />
            <Route path="/recursos/formadores" element={<TrainersView onNotify={pushToast} />} />
            <Route path="/recursos/salas" element={<RoomsView onNotify={pushToast} />} />
            <Route path="/recursos/unidades" element={<MobileUnitsView onNotify={pushToast} />} />
            <Route path="/recursos/templates" element={<CertificateTemplatesView onNotify={pushToast} />} />
            <Route path="/recursos/productos" element={<ProductsView onNotify={pushToast} />} />
            <Route path="/certificados/*" element={<CertificadosPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
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
