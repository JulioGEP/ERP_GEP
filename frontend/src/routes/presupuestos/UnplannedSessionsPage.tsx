import { UnplannedSessionsTable } from '../../features/presupuestos/UnplannedSessionsTable';

export function UnplannedSessionsPage() {
  return (
    <div className="d-grid gap-4">
      <header className="d-flex flex-column gap-2">
        <h1 className="h3 fw-bold mb-0">Sesiones sin agendar</h1>
        <p className="text-muted mb-0">
          Muestra las sesiones de Formación Empresa y GEP Services que aún no tienen fecha de inicio ni de fin.
        </p>
      </header>

      <UnplannedSessionsTable />
    </div>
  );
}

export default UnplannedSessionsPage;
