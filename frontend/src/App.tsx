import { useCallback, useMemo, useState } from 'react';
import { Container, Nav, Navbar, Button, Spinner, Toast, ToastContainer } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BudgetImportModal } from './features/presupuestos/BudgetImportModal';
import { BudgetTable } from './features/presupuestos/BudgetTable';
import { BudgetDetailModal } from './features/presupuestos/BudgetDetailModal';
import { ApiError, fetchDealsWithoutSessions, importDeal } from './features/presupuestos/api';
import type { DealSummary } from './types/deal';
import logo from './assets/gep-group-logo.png';

const NAVIGATION_ITEMS = ['Presupuestos', 'Calendario', 'Recursos'];

type ToastMessage = {
  id: string;
  variant: 'success' | 'danger';
  message: string;
};

export default function App() {
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedBudgetId, setSelectedBudgetId] = useState<number | null>(null);
  const [selectedBudgetSummary, setSelectedBudgetSummary] = useState<DealSummary | null>(null);
  const [activeTab, setActiveTab] = useState('Presupuestos');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

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

  const importMutation = useMutation({
    mutationFn: (dealId: string) => importDeal(dealId),
    onSuccess: (budget) => {
      setSelectedBudgetSummary(budget);
      setSelectedBudgetId(budget.dealId);
      pushToast({ variant: 'success', message: 'Presupuesto importado' });
      setShowImportModal(false);
      queryClient.invalidateQueries({ queryKey: ['deals', 'noSessions'] });
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : null;
      const code = apiError?.code ?? 'UNKNOWN_ERROR';
      const message = apiError?.message ?? 'No se ha podido importar el presupuesto. Inténtalo de nuevo más tarde.';
      pushToast({ variant: 'danger', message: `No se pudo importar. [${code}] ${message}` });
    }
  });

  const isBudgetsView = activeTab === 'Presupuestos';
  const secondaryTabs = useMemo(() => NAVIGATION_ITEMS.filter((item) => item !== 'Presupuestos'), []);
  const budgets = budgetsQuery.data ?? [];
  const isRefreshing = budgetsQuery.isFetching && !budgetsQuery.isLoading;
  const refreshDisabled = budgetsQuery.isLoading || isRefreshing;

  const handleSelectBudget = useCallback((budget: DealSummary) => {
    setSelectedBudgetSummary(budget);
    setSelectedBudgetId(budget.dealId);
  }, []);

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
            {NAVIGATION_ITEMS.map((item) => (
              <Nav.Item key={item}>
                <Nav.Link
                  active={activeTab === item}
                  onClick={() => setActiveTab(item)}
                  className="text-uppercase"
                >
                  {item}
                </Nav.Link>
              </Nav.Item>
            ))}
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
                <div className="d-flex align-items-center gap-3">
                  {(importMutation.isPending || isRefreshing) && (
                    <Spinner animation="border" role="status" size="sm" />
                  )}
                  <Button
                    variant="outline-secondary"
                    size="lg"
                    onClick={() => queryClient.invalidateQueries({ queryKey: ['deals', 'noSessions'] })}
                    disabled={refreshDisabled}
                  >
                    Refrescar
                  </Button>
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
              />
            </div>
          ) : (
            <div className="bg-white rounded-4 shadow-sm p-5 text-center text-muted">
              <h2 className="h4 fw-semibold mb-2">{activeTab}</h2>
              <p className="mb-0">
                Esta sección estará disponible próximamente. Mientras tanto, puedes seguir trabajando en la pestaña
                de Presupuestos.
              </p>
              <div className="d-flex justify-content-center gap-2 mt-4">
                {secondaryTabs.map((tab) => (
                  <Button key={tab} variant="outline-secondary" size="sm" disabled>
                    {tab}
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
