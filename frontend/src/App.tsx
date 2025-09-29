import { useMemo, useState } from 'react';
import { Container, Nav, Navbar, Button, Alert, Spinner } from 'react-bootstrap';
import { useMutation } from '@tanstack/react-query';
import { BudgetImportModal } from './features/presupuestos/BudgetImportModal';
import { BudgetTable } from './features/presupuestos/BudgetTable';
import { BudgetDetailModal } from './features/presupuestos/BudgetDetailModal';
import { importDeal } from './features/presupuestos/api';
import type { DealSummary } from './types/deal';
import logo from './assets/gep-group-logo.png';

const NAVIGATION_ITEMS = ['Presupuestos', 'Calendario', 'Recursos'];

export default function App() {
  const [showImportModal, setShowImportModal] = useState(false);
  const [budgets, setBudgets] = useState<DealSummary[]>([]);
  const [selectedBudget, setSelectedBudget] = useState<DealSummary | null>(null);
  const [activeTab, setActiveTab] = useState('Presupuestos');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: (federalNumber: string) => importDeal(federalNumber),
    onSuccess: (budget) => {
      setBudgets((previous) => {
        const filtered = previous.filter((item) => item.dealId !== budget.dealId);
        return [budget, ...filtered];
      });
      setSelectedBudget(budget);
      setErrorMessage(null);
      setShowImportModal(false);
    },
    onError: (error: unknown) => {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'No se ha podido importar el presupuesto. Inténtalo de nuevo más tarde.'
      );
    }
  });

  const isBudgetsView = activeTab === 'Presupuestos';
  const secondaryTabs = useMemo(() => NAVIGATION_ITEMS.filter((item) => item !== 'Presupuestos'), []);

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
                  {importMutation.isPending && <Spinner animation="border" role="status" size="sm" />}
                  <Button size="lg" onClick={() => setShowImportModal(true)}>
                    Importar presupuesto
                  </Button>
                </div>
              </section>

              {errorMessage && (
                <Alert
                  variant="danger"
                  className="rounded-4 shadow-sm"
                  onClose={() => setErrorMessage(null)}
                  dismissible
                >
                  {errorMessage}
                </Alert>
              )}

              <BudgetTable budgets={budgets} onSelect={setSelectedBudget} />
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
        onSubmit={(federalNumber) => importMutation.mutate(federalNumber)}
      />
      <BudgetDetailModal budget={selectedBudget} onClose={() => setSelectedBudget(null)} />
    </div>
  );
}
