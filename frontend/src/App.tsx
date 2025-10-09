import { useCallback, useMemo, useState } from 'react';
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BudgetImportModal } from './features/presupuestos/BudgetImportModal';
import { BudgetFiltersModal } from './features/presupuestos/BudgetFiltersModal';
import { BudgetTable } from './features/presupuestos/BudgetTable';
import { BudgetDetailModal } from './features/presupuestos/BudgetDetailModal';
import {
  ApiError,
  fetchDealsWithoutSessions,
  importDeal,
  deleteDeal,
} from './features/presupuestos/api';
import type { DealSummary } from './types/deal';
import logo from './assets/gep-group-logo.png';
import { TrainersView } from './features/recursos/TrainersView';
import { RoomsView } from './features/recursos/RoomsView';
import { MobileUnitsView } from './features/recursos/MobileUnitsView';
import {
  type ActiveBudgetFilter,
  type BudgetFilterKey,
  type BudgetFilters,
  applyBudgetFilters,
  cleanBudgetFilters,
  getActiveBudgetFilters,
} from './features/presupuestos/budgetFilters';

type NavView = {
  key: string;
  label: string;
};

type NavItem = NavView & {
  children?: NavView[];
};

const NAVIGATION_ITEMS: NavItem[] = [
  { key: 'Presupuestos', label: 'Presupuestos' },
  { key: 'Calendario', label: 'Calendario' },
  {
    key: 'Recursos',
    label: 'Recursos',
    children: [
      { key: 'Recursos/Formadores', label: 'Formadores / Bomberos' },
      { key: 'Recursos/Unidades', label: 'Unidades Móviles' },
      { key: 'Recursos/Salas', label: 'Salas' },
    ],
  },
];

const VIEW_ITEMS: NavView[] = NAVIGATION_ITEMS.flatMap((item) =>
  item.children ? item.children : [item]
);

const PLACEHOLDER_VIEWS: NavView[] = VIEW_ITEMS.filter(
  (item) =>
    item.key !== 'Presupuestos' &&
    item.key !== 'Recursos/Formadores' &&
    item.key !== 'Recursos/Salas' &&
    item.key !== 'Recursos/Unidades'
);

type ToastMessage = {
  id: string;
  variant: 'success' | 'danger';
  message: string;
};

export default function App() {
  const [showImportModal, setShowImportModal] = useState(false);
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(null);
  const [selectedBudgetSummary, setSelectedBudgetSummary] = useState<DealSummary | null>(null);
  const [activeView, setActiveView] = useState('Presupuestos');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [filters, setFilters] = useState<BudgetFilters>({});

  const queryClient = useQueryClient();

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

  const handleApplyFilters = useCallback((nextFilters: BudgetFilters) => {
    setFilters(cleanBudgetFilters(nextFilters));
    setShowFiltersModal(false);
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({});
  }, []);

  const handleRemoveFilter = useCallback((key: BudgetFilterKey) => {
    setFilters((current) => {
      if (!current || !(key in current)) return current;
      const { [key]: _removed, ...rest } = current;
      return rest;
    });
  }, []);

  const importMutation = useMutation({
    mutationFn: (dealId: string) => importDeal(dealId),
    onSuccess: (payload) => {
  // Soporta ambos formatos de retorno:
  // - DealSummary | null
  // - { deal: DealSummary | null, warnings?: string[] }
  const dealObj =
    payload && typeof payload === 'object' && 'deal' in (payload as any)
      ? (payload as any).deal
      : (payload as any);

  if (dealObj) {
    setSelectedBudgetSummary(dealObj as DealSummary);
    // Acepta dealId o deal_id y fuerza string|null
    setSelectedBudgetId(
      ((dealObj as any).dealId ?? (dealObj as any).deal_id ?? null) as string | null
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

  const isBudgetsView = activeView === 'Presupuestos';
  const isTrainersView = activeView === 'Recursos/Formadores';
  const isRoomsView = activeView === 'Recursos/Salas';
  const isMobileUnitsView = activeView === 'Recursos/Unidades';
  const activeViewLabel = useMemo(
    () => VIEW_ITEMS.find((item) => item.key === activeView)?.label ?? activeView,
    [activeView]
  );
  const placeholderViews = PLACEHOLDER_VIEWS;
  const budgets = budgetsQuery.data ?? [];
  const isRefreshing = budgetsQuery.isFetching && !budgetsQuery.isLoading;
  const cleanedFilters = useMemo(() => cleanBudgetFilters(filters), [filters]);
  const filteredBudgets = useMemo(
    () => applyBudgetFilters(budgets, cleanedFilters),
    [budgets, cleanedFilters]
  );
  const activeFilters = useMemo<ActiveBudgetFilter[]>(
    () => getActiveBudgetFilters(cleanedFilters),
    [cleanedFilters]
  );
  const hasActiveFilters = activeFilters.length > 0;

  const titleSuggestions = useMemo(() => {
    const values = new Set<string>();
    budgets.forEach((budget) => {
      const title = typeof budget.title === 'string' ? budget.title.trim() : '';
      if (title.length) values.add(title);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [budgets]);

  const trainingAddressSuggestions = useMemo(() => {
    const values = new Set<string>();
    budgets.forEach((budget) => {
      const address = typeof budget.training_address === 'string' ? budget.training_address.trim() : '';
      if (address.length) values.add(address);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [budgets]);

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
                  active={item.children.some((child) => child.key === activeView)}
                >
                  {item.children.map((child) => (
                    <NavDropdown.Item
                      key={child.key}
                      active={activeView === child.key}
                      onClick={(event) => {
                        event.preventDefault();
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
                    active={activeView === item.key}
                    onClick={() => setActiveView(item.key)}
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
          {isBudgetsView ? (
            <div className="d-grid gap-4">
              <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
                <div>
                  <h1 className="h3 fw-bold mb-1">Presupuestos</h1>
                  <p className="text-muted mb-0">Sube tu presupuesto y planifica</p>
                </div>
                <div className="d-flex align-items-center gap-3 flex-wrap justify-content-md-end">
                  {activeFilters.map((filter) => (
                    <span
                      key={filter.key}
                      className="badge rounded-pill text-bg-light d-inline-flex align-items-center gap-2"
                    >
                      <span className="d-flex flex-column flex-sm-row gap-1">
                        <span className="text-muted">{filter.label}:</span>
                        <span className="fw-semibold">{filter.value}</span>
                      </span>
                      <button
                        type="button"
                        className="btn btn-link p-0 border-0 text-muted"
                        onClick={() => handleRemoveFilter(filter.key)}
                        aria-label={`Eliminar filtro ${filter.label}`}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                  {(importMutation.isPending || isRefreshing) && (
                    <Spinner animation="border" role="status" size="sm" />
                  )}
                  <Button
                    variant="outline-primary"
                    size="lg"
                    onClick={() => setShowFiltersModal(true)}
                  >
                    Filtrar
                  </Button>
                  <Button size="lg" onClick={() => setShowImportModal(true)}>
                    Importar presupuesto
                  </Button>
                </div>
              </section>
              <BudgetTable
                budgets={filteredBudgets}
                isLoading={budgetsQuery.isLoading}
                isFetching={isRefreshing}
                error={budgetsQuery.error ?? null}
                onRetry={() => budgetsQuery.refetch()}
                onSelect={handleSelectBudget}
                onDelete={handleDeleteBudget}
                hasActiveFilters={hasActiveFilters}
                onClearFilters={hasActiveFilters ? handleClearFilters : undefined}
              />
            </div>
          ) : isTrainersView ? (
            <TrainersView onNotify={pushToast} />
          ) : isRoomsView ? (
            <RoomsView onNotify={pushToast} />
          ) : isMobileUnitsView ? (
            <MobileUnitsView onNotify={pushToast} />
          ) : (
            <div className="bg-white rounded-4 shadow-sm p-5 text-center text-muted">
              <h2 className="h4 fw-semibold mb-2">{activeViewLabel}</h2>
              <p className="mb-0">
                La sección {activeViewLabel} estará disponible próximamente. Mientras tanto, puedes seguir trabajando en
                la pestaña de Presupuestos.
              </p>
              <div className="d-flex justify-content-center gap-2 mt-4">
                {placeholderViews.map((view) => (
                  <Button key={view.key} variant="outline-secondary" size="sm" disabled>
                    {view.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </Container>
      </main>

      <footer className="py-4 bg-white mt-auto border-top">
        <Container fluid="xl" className="text-muted small d-flex justify-content-between align-items-center">
          <span>© {new Date().getFullYear()} GEP Group</span>
          <span>ERP colaborativo para planificación de formaciones</span>
        </Container>
      </footer>

      <BudgetFiltersModal
        show={showFiltersModal}
        filters={cleanedFilters}
        titleOptions={titleSuggestions}
        trainingAddressOptions={trainingAddressSuggestions}
        onApply={handleApplyFilters}
        onClearAll={handleClearFilters}
        onClose={() => setShowFiltersModal(false)}
      />

      <BudgetImportModal
        show={showImportModal}
        isLoading={importMutation.isPending}
        onClose={() => setShowImportModal(false)}
        onSubmit={(dealId) => importMutation.mutate(dealId)}
      />

      <BudgetDetailModal dealId={selectedBudgetId} summary={selectedBudgetSummary} onClose={handleCloseDetail} />

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
